<%@ page import="java.nio.charset.StandardCharsets,java.nio.file.*,java.text.SimpleDateFormat,java.util.*" %>
<%!
    private static final Set<String> ALLOWED_SOURCES = new HashSet<String>(Arrays.asList("NanYou", "58Suo", "BaoTong"));
    private static final String LOGS_ROOT = "/var/lib/tomcat/webapps/media/logs";

    private String escapeJson(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\b': out.append("\\b"); break;
                case '\f': out.append("\\f"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) out.append(String.format("\\u%04x", (int)c));
                    else out.append(c);
            }
        }
        return out.toString();
    }

    private int parsePositiveInt(String value, int defaultValue, int min, int max) {
        if (value == null || value.trim().isEmpty()) return defaultValue;
        try {
            int parsed = Integer.parseInt(value.trim());
            if (parsed < min) return min;
            if (parsed > max) return max;
            return parsed;
        } catch (Exception e) {
            return defaultValue;
        }
    }

    private String toTimeText(long millis) {
        if (millis <= 0) return "";
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date(millis));
    }
%>
<%
    request.setCharacterEncoding("UTF-8");
    response.setCharacterEncoding("UTF-8");
    response.setContentType("application/json;charset=UTF-8");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(200);
        out.print("{\"ok\":true}");
        return;
    }

    String source = request.getParameter("source");
    if (source == null || !ALLOWED_SOURCES.contains(source)) {
        response.setStatus(400);
        out.print("{\"ok\":false,\"msg\":\"invalid source, only NanYou / 58Suo / BaoTong\"}");
        return;
    }

    int lineLimit = parsePositiveInt(request.getParameter("lineLimit"), 120, 1, 5000);
    Path dataFile = Paths.get(LOGS_ROOT, source, "data.txt");

    if (!Files.exists(dataFile) || !Files.isRegularFile(dataFile)) {
        out.print("{\"ok\":true,\"source\":\"" + escapeJson(source) + "\",\"storage\":\"new\",\"folder\":\"" + escapeJson(Paths.get(LOGS_ROOT, source).toString()) + "\",\"fileCount\":0,\"entries\":[],\"msg\":\"data.txt not found\"}");
        return;
    }

    List<String> allLines;
    try {
        allLines = Files.readAllLines(dataFile, StandardCharsets.UTF_8);
    } catch (Exception ex) {
        response.setStatus(500);
        out.print("{\"ok\":false,\"msg\":\"read file failed\",\"detail\":\"" + escapeJson(ex.getMessage()) + "\"}");
        return;
    }

    int start = Math.max(0, allLines.size() - lineLimit);
    List<String> tail = allLines.subList(start, allLines.size());

    long mtime = 0L;
    try {
        mtime = Files.getLastModifiedTime(dataFile).toMillis();
    } catch (Exception ignored) {
        mtime = 0L;
    }

    StringBuilder json = new StringBuilder();
    json.append("{\"ok\":true");
    json.append(",\"source\":\"").append(escapeJson(source)).append("\"");
    json.append(",\"storage\":\"new\"");
    json.append(",\"folder\":\"").append(escapeJson(dataFile.getParent().toString())).append("\"");
    json.append(",\"fileCount\":1");
    json.append(",\"lineLimit\":").append(lineLimit);
    json.append(",\"entries\":[{");
    json.append("\"fileName\":\"data.txt\"");
    json.append(",\"path\":\"").append(escapeJson(dataFile.toString())).append("\"");
    json.append(",\"lastModified\":").append(mtime);
    json.append(",\"lastModifiedText\":\"").append(escapeJson(toTimeText(mtime))).append("\"");
    json.append(",\"lineCount\":").append(tail.size());
    json.append(",\"lines\":[");

    for (int i = 0; i < tail.size(); i++) {
        if (i > 0) json.append(",");
        json.append("\"").append(escapeJson(tail.get(i))).append("\"");
    }

    json.append("]}]}");
    out.print(json.toString());
%>
