package io.github.ledflighter.microimg;

import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

final class NdefText
{
    static NdefMessage message(String text)
    {
        return new NdefMessage(new NdefRecord[] {NdefRecord.createTextRecord("en", text)});
    }
    static String read(NdefMessage message) throws IOException
    {
        if(message == null)
            throw new IOException("Der Tag enthält keine NDEF-Daten.");
        for(NdefRecord record : message.getRecords())
        {
            byte[] payload = record.getPayload();
            String text = null;
            if(record.getTnf() == NdefRecord.TNF_WELL_KNOWN && Arrays.equals(record.getType(), NdefRecord.RTD_TEXT) && payload.length > 0)
            {
                int offset = 1 + (payload[0] & 0x3f);
                if(offset > payload.length)
                    throw new IOException("Ungültiger NDEF-Textkopf.");
                text = new String(payload, offset, payload.length - offset, (payload[0] & 0x80) == 0 ? StandardCharsets.UTF_8 : StandardCharsets.UTF_16);
            }
            else if(record.getTnf() == NdefRecord.TNF_MIME_MEDIA && Arrays.equals(record.getType(), "text/plain".getBytes(StandardCharsets.US_ASCII)))
                text = new String(payload, StandardCharsets.UTF_8);
            if(text != null && text.trim().matches("(?is)^P[0-9]+/[0-9]+#.+"))
                return text.trim();
        }
        throw new IOException("Auf diesem Tag wurde kein MicroIMG-Chunk gefunden.");
    }
}
