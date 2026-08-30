<%@ page import="java.io.*, java.nio.file.*, java.text.SimpleDateFormat, java.util.Date" contentType="text/plain;charset=UTF-8" trimDirectiveWhitespaces="true" session="false" %><%
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
        out.print("OK");
        return;
    }

    if (!"POST".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(405);
        out.print("Method Not Allowed");
        return;
    }

    boolean isSnapshot = "snapshot".equalsIgnoreCase(uploadType);
    String tempPath = null;
    String targetPath = null;

    try {
        InputStream raw = request.getInputStream();
        BufferedInputStream is = new BufferedInputStream(raw, 65536);
        ByteArrayOutputStream baos = new ByteArrayOutputStream(Math.max(request.getContentLength(), 65536));
        byte[] buf = new byte[65536];
        int len;
        while ((len = is.read(buf)) != -1) {
            baos.write(buf, 0, len);
        }
        is.close();

        byte[] frameBytes = baos.toByteArray();
        baos.close();

        if (frameBytes.length <= 0) {
            response.setStatus(400);
            out.print("Error: empty frame");
            return;
        }

        String targetDir;
        String fileName;

        if (isSnapshot) {
            targetDir = baseDir + "/snapshot1";
            fileName = request.getHeader("X-Filename");
            if (fileName == null || fileName.trim().length() == 0) {
                String ts = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS").format(new Date());
                fileName = "SNAPSHOT_" + ts + ".jpg";
            } else {
                fileName = Paths.get(fileName).getFileName().toString();
            }
        } else {
            targetDir = baseDir + "/video1";
            fileName = "latest.jpg";

            long now = System.currentTimeMillis();
            synchronized (application) {
                application.setAttribute("video1LatestBytes", frameBytes);
                application.setAttribute("video1LatestLength", Integer.valueOf(frameBytes.length));
                application.setAttribute("video1LatestTs", Long.valueOf(now));

                Long oldSeq = (Long) application.getAttribute("video1LatestSeq");
                long nextSeq = oldSeq == null ? 1L : oldSeq.longValue() + 1L;
                application.setAttribute("video1LatestSeq", Long.valueOf(nextSeq));

                application.setAttribute("ram_video_1", frameBytes);
                application.setAttribute("ram_video_1_ts", Long.valueOf(now));
                application.notifyAll();
            }
        }

        Files.createDirectories(Paths.get(targetDir));
        tempPath = targetDir + "/temp_" + System.nanoTime() + "_" + Thread.currentThread().getId() + ".jpg";
        targetPath = targetDir + "/" + fileName;

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
        response.setHeader("X-Upload-Storage", isSnapshot ? "disk" : "ram+disk");
        out.print("OK: upload1 " + uploadType + " -> " + targetPath);
    } catch (Exception e) {
        if (tempPath != null) {
            try { Files.deleteIfExists(Paths.get(tempPath)); } catch (Exception ignore) {}
        }
        response.setStatus(500);
        out.print("Error: " + e.getMessage());
    }
%>
