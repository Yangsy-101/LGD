<%@ page import="java.io.*, java.nio.charset.StandardCharsets, java.nio.file.*, java.text.SimpleDateFormat, java.util.Date, java.util.LinkedHashMap, java.util.Map" %>
<%
    request.setCharacterEncoding("UTF-8");
    response.setCharacterEncoding("UTF-8");
    response.setContentType("application/json;charset=UTF-8");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "*");

    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(200);
        out.print("{\"ok\":true}");
        return;
    }

    // 按你的 Tomcat 部署目录自行改这里
    String baseDir = "/var/lib/tomcat/webapps/media";
    String snapshotDir = baseDir + "/snapshot4";
    String videoDir = baseDir + "/video4";
    String jsonDir = baseDir + "/json4";
    int maxVideoFrameBytes = 2 * 1024 * 1024;
    int maxSnapshotBytes = 5 * 1024 * 1024;

    Files.createDirectories(Paths.get(snapshotDir));
    Files.createDirectories(Paths.get(videoDir));
    Files.createDirectories(Paths.get(jsonDir));

    // 仅支持 POST 上传图片字节流 -> 保存图片 + 保存同名 json
    String method = request.getMethod();

    if (!"POST".equalsIgnoreCase(method)) {
        response.setStatus(400);
        out.print("{\"ok\":false,\"message\":\"unsupported request, use POST for upload\"}");
        return;
    }

    // ========= 上传逻辑 =========
    String uploadType = request.getHeader("X-Upload-Type");
    if (uploadType == null || uploadType.trim().length() == 0) {
        uploadType = "video";
    }

    String ts = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS").format(new Date());
    String fileName;
    String tempPath;
    String targetPath;
    String metaPath;

    try {
        if ("env".equalsIgnoreCase(uploadType)) {
            String envPath = jsonDir + "/latest_env.json";
            String envTmpPath = envPath + ".tmp";

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            InputStream envStream = request.getInputStream();
            byte[] buf = new byte[8192];
            int len;
            while ((len = envStream.read(buf)) > 0) {
                baos.write(buf, 0, len);
            }
            envStream.close();

            byte[] envBytes = baos.toByteArray();
            if (envBytes.length == 0) {
                response.setStatus(400);
                out.print("{\"ok\":false,\"message\":\"empty env payload\"}");
                return;
            }

            Files.write(Paths.get(envTmpPath), envBytes, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            try {
                Files.move(Paths.get(envTmpPath), Paths.get(envPath), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ignore) {
                Files.move(Paths.get(envTmpPath), Paths.get(envPath), StandardCopyOption.REPLACE_EXISTING);
            }

            response.setStatus(200);
            out.print("{\"ok\":true,\"message\":\"env update success\",\"saved_path\":\"" + envPath + "\"}");
            return;
        }

        if ("snapshot".equalsIgnoreCase(uploadType)) {
            fileName = request.getHeader("X-Filename");
            if (fileName == null || fileName.trim().length() == 0) {
                fileName = "SNAPSHOT_" + ts + ".jpg";
            }
            tempPath = snapshotDir + "/temp_" + ts + ".jpg";
            targetPath = snapshotDir + "/" + fileName;

            int dot = fileName.lastIndexOf('.');
            String baseName = (dot > 0) ? fileName.substring(0, dot) : fileName;
            metaPath = jsonDir + "/" + baseName + ".json";
        } else {
            fileName = "latest.jpg";
            tempPath = videoDir + "/temp_" + ts + ".jpg";
            targetPath = videoDir + "/latest.jpg";
            metaPath = "";
        }

        InputStream is = request.getInputStream();
        ByteArrayOutputStream baos = new ByteArrayOutputStream(Math.max(request.getContentLength(), 65536));
        byte[] buf = new byte[65536];
        int len;
        while ((len = is.read(buf)) > 0) {
            baos.write(buf, 0, len);
        }
        is.close();

        byte[] uploadBytes = baos.toByteArray();
        baos.close();

        if (uploadBytes.length <= 0) {
            response.setStatus(400);
            out.print("{\"ok\":false,\"message\":\"empty upload payload\"}");
            return;
        }

        boolean isSnapshot = "snapshot".equalsIgnoreCase(uploadType);
        int maxUploadBytes = isSnapshot ? maxSnapshotBytes : maxVideoFrameBytes;
        if (uploadBytes.length > maxUploadBytes) {
            response.setStatus(413);
            out.print("{\"ok\":false,\"message\":\"upload payload too large\"}");
            return;
        }

        if (!isSnapshot) {
            long now = System.currentTimeMillis();
            synchronized (application) {
                application.setAttribute("video4LatestBytes", uploadBytes);
                application.setAttribute("video4LatestLength", Integer.valueOf(uploadBytes.length));
                application.setAttribute("video4LatestTs", Long.valueOf(now));

                Long oldSeq = (Long) application.getAttribute("video4LatestSeq");
                long nextSeq = oldSeq == null ? 1L : oldSeq.longValue() + 1L;
                application.setAttribute("video4LatestSeq", Long.valueOf(nextSeq));
                application.notifyAll();
            }
        }

        FileOutputStream fos = new FileOutputStream(tempPath);
        fos.write(uploadBytes);
        fos.close();

        Path source = Paths.get(tempPath);
        Path target = Paths.get(targetPath);
        try {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException ignore) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }

        if (isSnapshot) {
            Map<String, String> meta = new LinkedHashMap<String, String>();
            meta.put("image_name", fileName);

            boolean hasSensor = false;
            boolean hasTimestamp = false;
            String envCollectorTime = request.getHeader("X-Env-Collector-Time");
            if (envCollectorTime != null && envCollectorTime.trim().length() > 0) {
                meta.put("env_collector_time", envCollectorTime);
                hasTimestamp = true;
            }
            String tempC = request.getHeader("X-Temp-C");
            if (tempC != null && tempC.trim().length() > 0) {
                meta.put("temp_c", tempC);
                hasSensor = true;
            }
            String humidity = request.getHeader("X-Humidity-RH");
            if (humidity != null && humidity.trim().length() > 0) {
                meta.put("humidity_rh", humidity);
                hasSensor = true;
            }
            String dewpoint = request.getHeader("X-Dewpoint-C");
            if (dewpoint != null && dewpoint.trim().length() > 0) {
                meta.put("dewpoint_c", dewpoint);
                hasSensor = true;
            }
            String smokePpm = request.getHeader("X-Smoke-PPM");
            if (smokePpm != null && smokePpm.trim().length() > 0) {
                meta.put("smoke_ppm", smokePpm);
                hasSensor = true;
            }
            String smokeState = request.getHeader("X-Smoke-State");
            if (smokeState != null && smokeState.trim().length() > 0) {
                meta.put("smoke_state", smokeState);
                hasSensor = true;
            }

            if (hasTimestamp && hasSensor) {
                StringBuilder json = new StringBuilder();
                json.append("{");
                boolean first = true;
                for (Map.Entry<String, String> e : meta.entrySet()) {
                    if (e.getValue() == null || e.getValue().trim().length() == 0) continue;
                    if (!first) json.append(",");
                    first = false;
                    String k = e.getKey().replace("\\", "\\\\").replace("\"", "\\\"");
                    String v = e.getValue().replace("\\", "\\\\").replace("\"", "\\\"");
                    json.append("\"").append(k).append("\":\"").append(v).append("\"");
                }
                json.append("}");

                String metaTmpPath = metaPath + ".tmp";
                Files.write(Paths.get(metaTmpPath), json.toString().getBytes(StandardCharsets.UTF_8),
                        StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
                try {
                    Files.move(Paths.get(metaTmpPath), Paths.get(metaPath), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException ignore) {
                    Files.move(Paths.get(metaTmpPath), Paths.get(metaPath), StandardCopyOption.REPLACE_EXISTING);
                }
            } else {
                metaPath = "";
            }
        } else {
            metaPath = "";
        }

        response.setStatus(200);
        String safePath = targetPath.replace("\\", "\\\\").replace("\"", "\\\"");
        String safeMeta = metaPath.replace("\\", "\\\\").replace("\"", "\\\"");
        out.print("{\"ok\":true,\"message\":\"upload success\",\"saved_path\":\"" + safePath + "\",\"meta_path\":\"" + safeMeta + "\"}");
    } catch (Exception e) {
        response.setStatus(500);
        String msg = e.getMessage() == null ? "unknown error" : e.getMessage().replace("\\", "\\\\").replace("\"", "'");
        out.print("{\"ok\":false,\"message\":\"" + msg + "\"}");
    }
%>
