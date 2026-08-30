<%@ page import="java.io.*, java.nio.file.*" contentType="text/plain;charset=UTF-8" trimDirectiveWhitespaces="true" session="false" %><%
    request.setCharacterEncoding("UTF-8");

    String videoDir = "/var/lib/tomcat/webapps/media/video_only";
    String tempPath = null;
    String latestPath = videoDir + "/latest.jpg";

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);

    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(200);
        out.print("OK");
        return;
    }

    if (!"POST".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(405);
        out.print("Method Not Allowed");
        return;
    }

    try {
        InputStream is = new BufferedInputStream(request.getInputStream());
        ByteArrayOutputStream baos = new ByteArrayOutputStream(Math.max(request.getContentLength(), 65536));
        byte[] buf = new byte[65536];
        int len;
        while ((len = is.read(buf)) > 0) {
            baos.write(buf, 0, len);
        }
        is.close();

        byte[] frameBytes = baos.toByteArray();
        baos.close();

        if (frameBytes.length <= 0) {
            response.setStatus(400);
            out.print("ERROR: empty frame");
            return;
        }

        long now = System.currentTimeMillis();
        long nextSeq;
        synchronized (application) {
            application.setAttribute("ram_video_only", frameBytes);
            application.setAttribute("ram_video_only_length", Integer.valueOf(frameBytes.length));
            application.setAttribute("ram_video_only_ts", Long.valueOf(now));

            Long oldSeq = (Long) application.getAttribute("ram_video_only_seq");
            nextSeq = oldSeq == null ? 1L : oldSeq.longValue() + 1L;
            application.setAttribute("ram_video_only_seq", Long.valueOf(nextSeq));
            application.notifyAll();
        }

        Files.createDirectories(Paths.get(videoDir));
        tempPath = videoDir + "/temp_" + System.nanoTime() + "_" + Thread.currentThread().getId() + ".jpg";

        FileOutputStream fos = new FileOutputStream(tempPath);
        fos.write(frameBytes);
        fos.close();

        Path temp = Paths.get(tempPath);
        try {
            Files.move(temp, Paths.get(latestPath), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(temp, Paths.get(latestPath), StandardCopyOption.REPLACE_EXISTING);
        }

        response.setStatus(200);
        response.setHeader("X-Upload-Storage", "ram+disk");
        response.setHeader("X-Upload-Timestamp", String.valueOf(now));
        response.setHeader("X-Upload-Seq", String.valueOf(nextSeq));
        out.print("OK");
    } catch (Exception e) {
        if (tempPath != null) {
            try { Files.deleteIfExists(Paths.get(tempPath)); } catch (Exception ignore) {}
        }
        response.setStatus(500);
        out.print("ERROR: " + (e.getMessage() == null ? "unknown" : e.getMessage()));
    }
%>
