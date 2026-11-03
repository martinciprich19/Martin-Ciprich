package sk.rivapadel.apptest;

import java.net.URI;
import java.net.URISyntaxException;

final class AppPolicy {
    static final String HOME = "https://www.rivapadel.app/";

    static boolean trusted(String url) {
        if (url == null) return false;
        try {
            URI uri = new URI(url);
            return "https".equalsIgnoreCase(uri.getScheme())
                && "www.rivapadel.app".equalsIgnoreCase(uri.getHost())
                && uri.getRawUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (URISyntaxException error) {
            return false;
        }

    }

    static boolean resumable(String url) {
        if (!trusted(url)) return false;
        try {
            URI uri = new URI(url);
            return "/match".equals(uri.getPath()) && uri.getRawQuery() != null
                && java.util.regex.Pattern.compile("(?:^|&)id=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?:&|$)")
                    .matcher(uri.getRawQuery()).find();
        } catch (URISyntaxException error) {
            return false;
        }
    }
}
