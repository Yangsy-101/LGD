<%@ page import="java.io.*, java.nio.file.*, java.text.SimpleDateFormat, java.util.Date" %>
<%
    String baseDir = "/var/lib/tomcat/webapps/media";
    String uploadType = request.getHeader("X-Upload-Type");
    if (uploadType == null || uploadType.trim().length() == 0) {
        uploadType = "video";
    }

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);

    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
        response.setContentType("text/plain;charset=UTF-8");
        out.print("OK");
        return;
    }

    if (!"POST".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(405);
        response.setContentType("text/plain;charset=UTF-8");
        out.print("Method Not Allowed");
        return;
    }

    String tempPath = null;
    String targetPath = null;

    try {
        InputStream raw = request.getInputStream();
        BufferedInputStream is = new BufferedInputStream(raw, 65536);
        ByteArrayOutputStream baos = new ByteArrayOutputStream(Math.max(request.getContentLength(), 32768));
        byte[] buf = new byte[65536];
        int len;
        while ((len = is.read(buf)) != -1) {
            baos.write(buf, 0, len);
        }
        is.close();

        byte[] frameBytes = baos.toByteArray();
        if (frameBytes.length == 0) {
            response.setStatus(400);
            response.setContentType("text/plain;charset=UTF-8");
            out.print("Empty frame");
            return;
        }

        if ("snapshot".equalsIgnoreCase(uploadType)) {
            String snapshotDir = baseDir + "/snapshot4";
            Files.createDirectories(Paths.get(snapshotDir));

            String fileName = request.getHeader("X-Filename");
            if (fileName == null || fileName.trim().length() == 0) {
                String ts = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS").format(new Date());
                fileName = "SNAPSHOT_" + ts + ".jpg";
            }

            tempPath = snapshotDir + "/temp.jpg";
            targetPath = snapshotDir + "/" + fileName;
        } else {
            String videoDir = baseDir + "/video4";
            Files.createDirectories(Paths.get(videoDir));

            tempPath = videoDir + "/temp.jpg";
            targetPath = videoDir + "/latest.jpg";

            application.setAttribute("video4LatestBytes", frameBytes);
            application.setAttribute("video4LatestLength", Integer.valueOf(frameBytes.length));
            application.setAttribute("video4LatestTimestamp", Long.valueOf(System.currentTimeMillis()));
        }

        FileOutputStream fos = new FileOutputStream(tempPath);
        fos.write(frameBytes);
        fos.close();

        Path source = Paths.get(tempPath);
        Path target = Paths.get(targetPath);
        try {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }

        response.setStatus(200);
        response.setContentType("text/plain;charset=UTF-8");
        out.print("OK: upload4 " + uploadType + " -> " + targetPath);
    } catch (Exception e) {
        if (tempPath != null) {
            try { Files.deleteIfExists(Paths.get(tempPath)); } catch (Exception ignore) {}
        }
        response.setStatus(500);
        response.setContentType("text/plain;charset=UTF-8");
        out.print("Error: " + e.getMessage());
    }
%>
