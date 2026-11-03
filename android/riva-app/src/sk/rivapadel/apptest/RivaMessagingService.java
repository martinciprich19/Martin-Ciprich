package sk.rivapadel.apptest;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class RivaMessagingService extends FirebaseMessagingService {
    private static final String TAG = "RivaPadelPush";
    private static final String CHANNEL_ID = "riva_notifications";

    @Override public void onMessageReceived(RemoteMessage message) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return;

        String title = message.getData().get("title");
        String body = message.getData().get("body");
        if (title == null || title.trim().isEmpty()) title = "RIVA Padel";
        if (body == null || body.trim().isEmpty()) body = "Máš novú notifikáciu.";

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            Log.e(TAG, "Android notification manager is unavailable.");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID,
                "RIVA notifikácie", NotificationManager.IMPORTANCE_HIGH));
        }

        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setAction(Intent.ACTION_VIEW);
        openApp.setData(Uri.parse(AppPolicy.HOME + "profile"));
        openApp.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int requestCode = message.getData().getOrDefault("id", body).hashCode();
        PendingIntent tap = PendingIntent.getActivity(this, requestCode, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build();
        try {
            manager.notify(requestCode, notification);
        } catch (SecurityException error) {
            Log.w(TAG, "Notification permission was revoked before delivery.", error);
        }
    }
}
