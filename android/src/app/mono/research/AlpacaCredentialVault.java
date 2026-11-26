package app.mono.research;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class AlpacaCredentialVault {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "mono.alpaca.credentials.v1";
    private static final String STORED_VALUE = "alpaca";
    private static final String VERSION = "v1";
    private static final int MAX_BYTES = 4096;
    private static final byte[] AAD = ALIAS.getBytes(StandardCharsets.UTF_8);

    private final SharedPreferences preferences;

    AlpacaCredentialVault(Context context) {
        preferences = context.getSharedPreferences("mono_credentials", Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public synchronized String loadAlpaca() {
        try {
            String envelope = preferences.getString(STORED_VALUE, null);
            if (envelope == null) return null;
            String[] parts = envelope.split("\\.", 3);
            if (parts.length != 3 || !VERSION.equals(parts[0])) return null;
            byte[] iv = Base64.decode(parts[1], Base64.NO_WRAP);
            if (iv.length != 12) return null;

            SecretKey key = (SecretKey) keystore().getKey(ALIAS, null);
            if (key == null) return null;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            cipher.updateAAD(AAD);
            byte[] plaintext = cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP));
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IOException | RuntimeException error) {
            return null;
        }
    }

    @JavascriptInterface
    public synchronized boolean saveAlpaca(String json) {
        if (json == null || json.isEmpty() || json.length() > MAX_BYTES) return false;
        try {
            JSONObject settings = new JSONObject(json);
            byte[] plaintext = settings.toString().getBytes(StandardCharsets.UTF_8);
            if (settings.length() == 0 || plaintext.length > MAX_BYTES) return false;

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, createOrLoadKey());
            cipher.updateAAD(AAD);
            String envelope = VERSION + "." + Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
                + "." + Base64.encodeToString(cipher.doFinal(plaintext), Base64.NO_WRAP);
            return preferences.edit().putString(STORED_VALUE, envelope).commit();
        } catch (GeneralSecurityException | IOException | JSONException | RuntimeException error) {
            return false;
        }
    }

    @JavascriptInterface
    public synchronized boolean clearAlpaca() {
        boolean cleared = false;
        try {
            cleared = preferences.edit().remove(STORED_VALUE).commit();
            keystore().deleteEntry(ALIAS);
            return true;
        } catch (GeneralSecurityException | IOException | RuntimeException error) {
            return cleared;
        }
    }

    private static KeyStore keystore() throws GeneralSecurityException, IOException {
        KeyStore keystore = KeyStore.getInstance(KEYSTORE);
        keystore.load(null);
        return keystore;
    }

    private static SecretKey createOrLoadKey() throws GeneralSecurityException, IOException {
        SecretKey existing = (SecretKey) keystore().getKey(ALIAS, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
