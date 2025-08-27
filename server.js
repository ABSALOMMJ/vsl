// Server for processing video sales letters
// Required packages: express, multer, socket.io, cors, fluent-ffmpeg
// Install with: npm install express multer socket.io cors fluent-ffmpeg
// You ALSO need to install FFmpeg on your system: https://ffmpeg.org/download.html

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity
    }
});

app.use(cors());
app.use('/processed', express.static(path.join(__dirname, 'processed')));

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const processedDir = path.join(__dirname, 'processed');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir);

// Setup multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });

let userSocket = null;
io.on('connection', (socket) => {
    console.log('A user connected');
    userSocket = socket;
    socket.on('disconnect', () => {
        console.log('User disconnected');
        userSocket = null;
    });
});

// Route to handle video upload and transcript
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No video file uploaded' });
    }

    const videoPath = req.file.path;
    const transcript = req.body.transcript || '';
    const outputFileName = `processed-${Date.now()}.mp4`;
    const outputPath = path.join(processedDir, outputFileName);

    console.log('File uploaded:', videoPath);
    console.log('Transcript received:', transcript);
    
    // Send success response to frontend immediately
    res.json({ success: true, message: 'Upload successful, processing started.' });

    // Start FFmpeg processing
    processVideoWithFfmpeg(videoPath, transcript, outputPath, outputFileName);
});

function processVideoWithFfmpeg(videoPath, transcript, outputPath, outputFileName) {
    // Generate a subtitle file (.srt format)
    const words = transcript.trim().split(/\s+/);
    let srtContent = '';
    let line = '';
    let lineIndex = 1;
    let startTime = 0;
    const wordsPerLine = 5; 
    const durationPerLine = 3; // seconds

    for (let i = 0; i < words.length; i++) {
        line += words[i] + ' ';
        if ((i + 1) % wordsPerLine === 0 || i === words.length - 1) {
            const endTime = startTime + durationPerLine;
            const formatTime = (s) => new Date(s * 1000).toISOString().substr(11, 8) + ',000';
            
            srtContent += `${lineIndex}\n`;
            srtContent += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`;
            srtContent += `${line.trim()}\n\n`;
            
            line = '';
            lineIndex++;
            startTime = endTime;
        }
    }
    
    const srtPath = `${videoPath}.srt`;
    fs.writeFileSync(srtPath, srtContent);

    console.log('Generated SRT file:', srtPath);

    // Use FFmpeg to burn subtitles
    ffmpeg(videoPath)
        .videoFilters(`subtitles=${srtPath}:force_style='Alignment=2,Fontsize=24,PrimaryColour=&Hffffff&'`)
        .on('progress', (progress) => {
            const currentProgress = Math.floor(progress.percent);
            console.log('Processing: ' + currentProgress + '% done');
            if (userSocket && currentProgress > 0) {
                userSocket.emit('processing_progress', { progress: currentProgress });
            }
        })
        .on('end', () => {
            console.log('Processing finished successfully');
            if (userSocket) {
                const downloadUrl = `http://localhost:4000/processed/${outputFileName}`;
                userSocket.emit('processing_complete', { downloadUrl });
            }
            // Clean up original files
            fs.unlinkSync(videoPath);
            fs.unlinkSync(srtPath);
        })
        .on('error', (err) => {
            console.error('Error during processing:', err.message);
            // Clean up original files
            fs.unlinkSync(videoPath);
            fs.unlinkSync(srtPath);
        })
        .save(outputPath);
}

const PORT = 4000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
