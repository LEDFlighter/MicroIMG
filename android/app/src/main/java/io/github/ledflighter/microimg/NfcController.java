package io.github.ledflighter.microimg;

import android.app.Activity;
import android.nfc.NdefMessage;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.TagLostException;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.nfc.tech.TagTechnology;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

final class NfcController implements NfcAdapter.ReaderCallback
{
    interface Listener { void event(JSONObject data); }
    private final Activity activity;
    private final Listener listener;
    private final NfcAdapter adapter;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile TagTechnology activeTechnology;
    private volatile String mode = "idle";
    private volatile boolean resumed;
    private volatile WriteBatch batch;
    private static final class WriteBatch
    {
        final List<String> chunks;
        final Set<String> writtenIds = new HashSet<>();
        int index;
        WriteBatch(List<String> chunks) { this.chunks = chunks; }
    }

    NfcController(Activity activity, Listener listener)
    {
        this.activity = activity;
        this.listener = listener;
        adapter = NfcAdapter.getDefaultAdapter(activity);
    }
    void status()
    {
        emit("hardware", "", "available", adapter != null, "enabled", adapter != null && adapter.isEnabled());
    }
    void resume()
    {
        resumed = true;
        status();
        updateReader();
    }
    void pause()
    {
        resumed = false;
        if(adapter != null)
            adapter.disableReaderMode(activity);
        if(!mode.equals("idle"))
            cancel("NFC pausiert. Zum Fortsetzen erneut Lesen oder Schreiben starten.");
    }
    boolean isRunning() { return !mode.equals("idle"); }
    synchronized void startRead()
    {
        if(!ready()) return;
        cancel(null);
        mode = "read";
        updateReader();
        emit("reading", "Tag an die NFC-Antenne des Smartphones halten.");
    }
    synchronized void startWrite(JSONArray input)
    {
        if(!ready()) return;
        if(input.length() == 0 || input.length() > 4096)
            throw new IllegalArgumentException("Ungültige Anzahl an Tags.");
        List<String> validated = new ArrayList<>();
        for(int i = 0; i < input.length(); i++)
        {
            String text = input.optString(i);
            String prefix = "P" + (i + 1) + "/" + input.length() + "#";
            if(!text.startsWith(prefix) || text.length() <= prefix.length() || text.length() > 65526 || !text.matches("[\\x20-\\x7e]+"))
                throw new IllegalArgumentException("Ungültiger MicroIMG-Chunk.");
            validated.add(text);
        }
        cancel(null);
        batch = new WriteBatch(validated);
        mode = "write";
        updateReader();
        emit("writing", "Tag 1 von " + validated.size() + " anhalten. Vorhandene Daten werden ersetzt.", "index", 0, "total", validated.size());
    }
    private boolean ready()
    {
        if(adapter == null || !adapter.isEnabled())
        {
            status();
            emit("error", adapter == null ? "Dieses Gerät besitzt keine NFC-Hardware." : "Bitte NFC in den Android-Einstellungen einschalten.");
            return false;
        }
        return true;
    }
    private void updateReader()
    {
        if(adapter == null || !resumed || !adapter.isEnabled()) return;
        if(mode.equals("idle"))
            adapter.disableReaderMode(activity);
        else
        {
            Bundle options = new Bundle();
            options.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 150);
            adapter.enableReaderMode(activity, this, NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V, options);
        }
    }
    synchronized void cancel(String message)
    {
        generation.incrementAndGet();
        mode = "idle";
        TagTechnology technology = activeTechnology;
        activeTechnology = null;
        if(technology != null)
            new Thread(() -> close(technology), "nfc-cancel").start();
        updateReader();
        if(message != null) emit("cancelled", message);
    }
    void stopRead()
    {
        if(mode.equals("read")) cancel(null);
    }
    @Override public synchronized void onTagDiscovered(Tag tag)
    {
        if(mode.equals("idle") || !busy.compareAndSet(false, true)) return;
        int token = generation.get();
        String operation = mode;
        WriteBatch currentBatch = batch;
        worker.execute(() -> {
            try
            {
                if(token != generation.get()) return;
                String id = hex(tag.getId());
                if(operation.equals("write") && currentBatch.writtenIds.contains(id))
                    throw new IOException("Dieser Tag wurde bereits beschrieben. Bitte einen anderen Tag verwenden.");
                Ndef ndef = Ndef.get(tag);
                if(ndef == null)
                {
                    if(!operation.equals("write"))
                        throw new IOException("Dieser Tag enthält keine lesbaren NDEF-Daten.");
                    NdefFormatable blank = NdefFormatable.get(tag);
                    if(blank == null)
                        throw new IOException("Der Tag unterstützt kein NDEF oder benötigt eine spezielle Formatierung.");
                    activeTechnology = blank;
                    blank.connect();
                    if(token != generation.get()) return;
                    blank.format(NdefText.message(currentBatch.chunks.get(currentBatch.index)));
                    emitForSession(token, "retry", "Tag formatiert. Bitte entfernen und denselben Tag zur Prüfung erneut anhalten.");
                    return;
                }
                activeTechnology = ndef;
                ndef.connect();
                if(token != generation.get()) return;
                int capacity = ndef.getMaxSize();
                if(operation.equals("read"))
                {
                    String text = NdefText.read(ndef.getNdefMessage());
                    emitForSession(token, "chunk", "Tag gelesen.", "text", text, "uid", id, "capacity", capacity);
                }
                else
                {
                    NdefMessage expected = NdefText.message(currentBatch.chunks.get(currentBatch.index));
                    if(!ndef.isWritable()) throw new IOException("Dieser Tag ist schreibgeschützt.");
                    if(expected.toByteArray().length > capacity)
                        throw new IOException("Tag zu klein: " + capacity + " Byte NDEF verfügbar, " + expected.toByteArray().length + " Byte benötigt. Kleineren Tagtyp auswählen und die Serie neu starten.");
                    if(token != generation.get()) return;
                    ndef.writeNdefMessage(expected);
                    NdefMessage actual = ndef.getNdefMessage();
                    if(actual == null || !Arrays.equals(expected.toByteArray(), actual.toByteArray()))
                        throw new IOException("Prüfung fehlgeschlagen. Denselben Tag erneut anhalten.");
                    synchronized(NfcController.this)
                    {
                        if(token != generation.get()) return;
                        currentBatch.writtenIds.add(id);
                        int completed = ++currentBatch.index;
                        boolean done = completed == currentBatch.chunks.size();
                        if(done) mode = "idle";
                        emitForSession(token, done ? "written" : "progress", done ? "Alle " + completed + " Tags geschrieben und geprüft." : "Tag " + completed + " geprüft. Entfernen und Tag " + (completed + 1) + " anhalten.", "index", completed, "total", currentBatch.chunks.size(), "uid", id, "capacity", capacity);
                        if(done) activity.runOnUiThread(this::updateReader);
                    }
                }
            }
            catch(Exception error)
            {
                emitForSession(token, "retry", error instanceof TagLostException ? "Verbindung verloren. Denselben Tag ruhig an die Antenne halten und erneut versuchen." : error.getMessage() == null ? "NFC-Fehler. Tag entfernen und erneut anhalten." : error.getMessage());
            }
            finally
            {
                TagTechnology technology = activeTechnology;
                activeTechnology = null;
                close(technology);
                busy.set(false);
            }
        });
    }
    private static void close(TagTechnology technology)
    {
        if(technology != null)
            try { technology.close(); } catch(IOException ignored) { }
    }
    private static String hex(byte[] bytes)
    {
        StringBuilder text = new StringBuilder();
        for(byte value : bytes) text.append(String.format(java.util.Locale.ROOT, "%02X", value & 255));
        return text.toString();
    }
    private void emit(String type, String message, Object... values)
    {
        JSONObject data = new JSONObject();
        try
        {
            data.put("type", type);
            data.put("message", message);
            for(int i = 0; i < values.length; i += 2) data.put((String)values[i], values[i + 1]);
        }
        catch(org.json.JSONException error) { throw new IllegalStateException(error); }
        listener.event(data);
    }
    private void emitForSession(int token, String type, String message, Object... values)
    {
        activity.runOnUiThread(() -> {
            if(token == generation.get()) emit(type, message, values);
        });
    }
    void destroy()
    {
        cancel(null);
        worker.shutdownNow();
    }
}
