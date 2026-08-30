<%@ page import="java.io.*" trimDirectiveWhitespaces="true" session="false" %><%
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Expose-Headers", "X-Frame-Source, X-Frame-Timestamp, X-Frame-Seq");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);

    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
        response.setContentType("text/plain;charset=UTF-8");
        out.print("OK");
        return;
    }

    if (!"GET".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(405);
        response.setContentType("text/plain;charset=UTF-8");
        out.print("Method Not Allowed");
        return;
    }

    Long sinceSeq = null;
    try {
        String since = request.getParameter("since");
        if (since != null && since.trim().length() > 0) {
            sinceSeq = Long.valueOf(since.trim());
        }
    } catch (Exception ignore) {}

    int waitMs = 0;
    try {
        String wait = request.getParameter("wait");
        if ("1".equals(wait) || "true".equalsIgnoreCase(wait)) {
            waitMs = 1200;
        }
        String timeout = request.getParameter("timeout");
        if (timeout != null && timeout.trim().length() > 0) {
            waitMs = Math.max(0, Math.min(3000, Integer.parseInt(timeout.trim())));
        }
    } catch (Exception ignore) {
        waitMs = 1200;
    }

    byte[] frameBytes = null;
    Integer frameLength = null;
    Long frameTs = null;
    Long frameSeq = null;

    synchronized (application) {
        frameSeq = (Long) application.getAttribute("video4LatestSeq");
        if (waitMs > 0 && sinceSeq != null && frameSeq != null && frameSeq.longValue() <= sinceSeq.longValue()) {
            long endAt = System.currentTimeMillis() + waitMs;
            while (System.currentTimeMillis() < endAt) {
                long remain = endAt - System.currentTimeMillis();
                if (remain <= 0) break;
                try {
                    application.wait(Math.min(250L, remain));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
                frameSeq = (Long) application.getAttribute("video4LatestSeq");
                if (frameSeq != null && frameSeq.longValue() > sinceSeq.longValue()) {
                    break;
                }
            }
        }

        frameBytes = (byte[]) application.getAttribute("video4LatestBytes");
        frameLength = (Integer) application.getAttribute("video4LatestLength");
        frameTs = (Long) application.getAttribute("video4LatestTs");
        frameSeq = (Long) application.getAttribute("video4LatestSeq");
    }

    if (waitMs > 0 && sinceSeq != null && frameSeq != null && frameSeq.longValue() <= sinceSeq.longValue()) {
        response.setStatus(204);
        response.setHeader("X-Frame-Source", "none");
        response.setHeader("X-Frame-Seq", String.valueOf(frameSeq.longValue()));
        out.clear();
        out = pageContext.pushBody();
        return;
    }

    if (frameBytes != null && frameLength != null && frameLength.intValue() > 0) {
        response.setContentType("image/jpeg");
        response.setContentLength(frameLength.intValue());
        response.setHeader("X-Frame-Source", "ram");
        if (frameTs != null) response.setHeader("X-Frame-Timestamp", String.valueOf(frameTs.longValue()));
        if (frameSeq != null) response.setHeader("X-Frame-Seq", String.valueOf(frameSeq.longValue()));
        OutputStream os = response.getOutputStream();
        os.write(frameBytes, 0, frameLength.intValue());
        os.flush();
        out.clear();
        out = pageContext.pushBody();
        return;
    }

    File file = new File("/var/lib/tomcat/webapps/media/video4/latest.jpg");
    if (!file.exists() || !file.isFile()) {
        response.setStatus(404);
        response.setContentType("text/plain;charset=UTF-8");
        out.print("video4/latest.jpg not found");
        return;
    }

    response.setContentType("image/jpeg");
    response.setContentLength((int) file.length());
    response.setHeader("X-Frame-Source", "disk");
    response.setHeader("X-Frame-Timestamp", String.valueOf(file.lastModified()));
    OutputStream os = response.getOutputStream();
    FileInputStream fis = new FileInputStream(file);
    byte[] buf = new byte[65536];
    int len;
    while ((len = fis.read(buf)) != -1) {
        os.write(buf, 0, len);
    }
    fis.close();
    os.flush();

    out.clear();
    out = pageContext.pushBody();
%>
