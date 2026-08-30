<%@ page import="java.io.*, java.util.*" %>
<%@ page contentType="application/json;charset=UTF-8" %>
<%
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);

    String folder = request.getParameter("folder");
    if (folder == null || folder.trim().length() == 0) {
        folder = "json4";
    }

    if (folder.contains("/") || folder.contains("\\") || folder.contains("..")) {
        out.print("[]");
        return;
    }

    final boolean includeEnv = "1".equals(request.getParameter("includeEnv")) || "true".equalsIgnoreCase(request.getParameter("includeEnv"));
    String sort = request.getParameter("sort");
    final boolean asc = "asc".equalsIgnoreCase(sort);

    int limit = 0;
    try {
        String limitText = request.getParameter("limit");
        if (limitText != null && limitText.trim().length() > 0) {
            limit = Math.max(0, Math.min(500, Integer.parseInt(limitText.trim())));
        }
    } catch (Exception ignore) {}

    File dir = new File("/var/lib/tomcat/webapps/media/" + folder);
    File[] files = dir.listFiles(new FilenameFilter() {
        public boolean accept(File d, String name) {
            String lower = name.toLowerCase();
            if (!lower.endsWith(".json")) return false;
            return includeEnv || !"latest_env.json".equals(lower);
        }
    });

    if (files == null || files.length == 0) {
        out.print("[]");
        return;
    }

    Arrays.sort(files, new Comparator<File>() {
        public int compare(File f1, File f2) {
            int cmp = Long.compare(f1.lastModified(), f2.lastModified());
            if (!asc) cmp = -cmp;
            if (cmp != 0) return cmp;
            return f1.getName().compareTo(f2.getName());
        }
    });

    int count = files.length;
    int start = 0;
    if (limit > 0 && count > limit) {
        if (asc) {
            start = count - limit;
        }
        count = limit;
    }

    out.print("[");
    for (int i = 0; i < count; i++) {
        File f = files[start + i];
        String safeName = f.getName().replace("\\", "\\\\").replace("\"", "\\\"");
        out.print("\"" + safeName + "\"");
        if (i < count - 1) out.print(",");
    }
    out.print("]");
%>
