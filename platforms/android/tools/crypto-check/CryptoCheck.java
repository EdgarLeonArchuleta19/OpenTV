import com.techpoint.opentv.service.Crypto;

/* Prints the Java crypto/digest outputs for fixed inputs; check.cjs prints
   the same lines from service/magis.js and compares them. */
public class CryptoCheck {
    public static void main(String[] args) throws Exception {
        String[] plains = {
            "{\"portalCode\":\"masnew\",\"userId\":\"\",\"sn\":\"abc\",\"sdkVer\":33}",
            "", "a", "ñandú 日本 é", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef!"
        };
        for (String p : plains) {
            String enc = Crypto.encryptBody(p);
            System.out.println("enc " + enc);
            System.out.println("dec " + Crypto.decryptBlob(enc));
        }
        for (int n : new int[] {0, 1, 55, 56, 63, 64, 65, 119, 120, 200}) {
            byte[] b = new byte[n];
            for (int i = 0; i < n; i++) b[i] = (byte) (i * 37 + 11);
            System.out.println("dig " + n + " " + Crypto.liveDigestHex(b));
        }
        System.out.println("o3 " + Crypto.signO3("0123456789abcdef0123456789abcdef", 1731264000123L));
        System.out.println("o3 " + Crypto.signO3("", 0L));
        System.out.println("md5 " + Crypto.md5Hex("snTokenXYZ" + "ntFT65w6itH!lHCPw7D=@qnsFC5adD28"));
        System.out.println("b64u " + Crypto.base64Url("https://cdn.example.com/live/a b?x=1&y=ñ"));
        System.out.println("b64ud " + Crypto.fromBase64Url(Crypto.base64Url("https://cdn.example.com/live/a b?x=1&y=ñ")));
    }
}
