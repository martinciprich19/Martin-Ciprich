package sk.rivapadel.apptest;

final class ClickerSession {
    private final int[] ids = {-1, -1};
    private final String[] descriptors = {null, null};
    private String match;
    private boolean confirmed;
    private final java.util.Map<Integer, Integer> pressed = new java.util.HashMap<>();

    boolean track(String next) {
        if (next == null ? match == null : next.equals(match)) return false;
        match = next;
        reset();
        return true;
    }

    void reset() {
        ids[0] = ids[1] = -1;
        descriptors[0] = descriptors[1] = null;
        confirmed = false;
        pressed.clear();
    }

    boolean blocked() { return match != null && !confirmed; }
    boolean hasMatch() { return match != null; }
    int id(int team) { return ids[team]; }
    boolean assigned(int team) { return descriptors[team] != null; }
    int nextTeam() { return descriptors[0] == null ? 0 : descriptors[1] == null ? 1 : -1; }

    boolean assign(int id, String descriptor, boolean virtual) {
        int team = nextTeam();
        if (team < 0 || id < 0 || virtual || descriptor == null || descriptor.isEmpty()
            || ids[1 - team] == id || descriptor.equals(descriptors[1 - team])) return false;
        ids[team] = id;
        descriptors[team] = descriptor;
        return true;
    }

    boolean confirm() {
        if (match == null || nextTeam() != -1 || ids[0] < 0 || ids[1] < 0 || !pressed.isEmpty()) return false;
        confirmed = true;
        return true;
    }

    int team(int id, String descriptor) {
        for (int i = 0; i < 2; i++)
            if (ids[i] == id && descriptors[i] != null && descriptors[i].equals(descriptor)) return i;
        return -1;
    }

    boolean invalidates(int id) { return ids[0] == id || ids[1] == id; }

    boolean reconnect(int id, String descriptor, boolean virtual) {
        if (id < 0 || virtual || descriptor == null || descriptor.isEmpty()) return false;
        for (int team = 0; team < 2; team++) {
            if (!descriptor.equals(descriptors[team])) continue;
            if (ids[team] >= 0 && ids[team] != id) return false;
            if (ids[1 - team] == id) return false;
            ids[team] = id;
            return true;
        }
        return false;
    }

    void disconnect(int id) {
        for (int team = 0; team < 2; team++)
            if (ids[team] == id) ids[team] = -1;
        pressed.remove(id);
    }

    void pause() { pressed.clear(); }

    boolean press(int id, int key, int repeat) {
        if (repeat != 0 || pressed.containsKey(id)) return false;
        pressed.put(id, key);
        return true;
    }

    void release(int id, int key) {
        Integer current = pressed.get(id);
        if (current != null && current == key) pressed.remove(id);
    }
}
