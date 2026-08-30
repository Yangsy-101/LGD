<%@ page import="java.io.*, java.nio.file.*, java.text.SimpleDateFormat, java.util.Date" %>
<%
    String baseDir = "/var/lib/tomcat/webapps/media";
    String uploadType = request.getHeader("X-Upload-Type");
    if (uploadType == null || uploadType.trim().length() == 0) {
        uploadType = "video";
    }

    String tempPath;
    String targetPath;

    try {
        if ("snapshot".equalsIgnoreCase(uploadType)) {
            String snapshotDir = baseDir + "/snapshot5";
            Files.createDirectories(Paths.get(snapshotDir));

            String fileName = request.getHeader("X-Filename");
            if (fileName == null || fileName.trim().length() == 0) {
                String ts = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS").format(new Date());
                fileName = "SNAPSHOT_" + ts + ".jpg";
            }

            tempPath = snapshotDir + "/temp.jpg";
            targetPath = snapshotDir + "/" + fileName;
        } else {
            String videoDir = baseDir + "/video5";
            Files.createDirectories(Paths.get(videoDir));

            tempPath = videoDir + "/temp.jpg";
            targetPath = videoDir + "/latest.jpg";
        }

        InputStream is = request.getInputStream();
        ByteArrayOutputStream baos = new ByteArrayOutputStream(64 * 1024);
        byte[] buf = new byte[8192];
        int len;
        while ((len = is.read(buf)) > 0) {
            baos.write(buf, 0, len);
        }
        is.close();

        byte[] frameBytes = baos.toByteArray();
        baos.close();
        if (frameBytes.length == 0) {
            response.setStatus(400);
            out.print("Error: empty payload");
            return;
        }

        if (!"snapshot".equalsIgnoreCase(uploadType)) {
            application.setAttribute("ram_video_5", frameBytes);
        }

        FileOutputStream fos = new FileOutputStream(tempPath);
        fos.write(frameBytes);
        fos.flush();
        fos.close();

        Path source = Paths.get(tempPath);
        Path target = Paths.get(targetPath);
        Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);

        response.setStatus(200);
        out.print("OK: upload5 " + uploadType + " -> " + targetPath + " (" + frameBytes.length + " bytes)");

    } catch (Exception e) {
        response.setStatus(500);
        out.print("Error: " + e.getMessage());
    }
%>
