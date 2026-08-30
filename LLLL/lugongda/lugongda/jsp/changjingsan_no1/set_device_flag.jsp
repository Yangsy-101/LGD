<%@ page import="java.io.*" %>
<%@ page contentType="application/json; charset=UTF-8" %>
<%
response.setHeader("Access-Control-Allow-Origin", "*");
response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
response.setHeader("Access-Control-Allow-Headers", "Content-Type");

if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
    return;
}

String device = request.getParameter("device");
String state = request.getParameter("state");

int flag = "on".equalsIgnoreCase(state) ? 1 : 0;
String filename = null;
if ("beacon".equals(device)) {
    filename = "b1.txt";
} else if ("valve".equals(device)) {
    filename = "c1.txt";
}

if (filename == null) {
    response.setStatus(400);
    out.print("{\"ok\":false,\"error\":\"invalid device\"}");
    return;
}

String baseDir = "/var/lib/tomcat/webapps/media";
File dir = new File(baseDir);
if (!dir.exists() && !dir.mkdirs()) {
    response.setStatus(500);
    out.print("{\"ok\":false,\"error\":\"failed to create c3 dir\"}");
    return;
}

File target = new File(dir, filename);
Writer writer = null;
try {
    writer = new OutputStreamWriter(new FileOutputStream(target, false), "UTF-8");
    writer.write("flag=" + flag);
} catch (Exception ex) {
    response.setStatus(500);
    out.print("{\"ok\":false,\"error\":\"write failed\"}");
    return;
} finally {
    if (writer != null) {
        try { writer.close(); } catch (Exception ignore) {}
    }
}

out.print("{\"ok\":true,\"device\":\"" + device + "\",\"flag\":" + flag + "}");
%>
