// the Zed LiveServer extension is not loading MediaPipe files correctly
// either switch to VS Code with its LiveServer extension... or, in Zed:
// change directory in Terminal to mp_example with "cd mp_example" command
// then, launch server with:
// "python3 -m http.server 8000" on macOS
// "python -m http.server 8000" on Windows
// then, open your browser window at 127.0.0.1:8000

import {
  FilesetResolver,
  PoseLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
);

const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "./models/pose_landmarker_full.task",
  },
  runningMode: "VIDEO"
});

const video = document.getElementById("video");

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: 640,
      height: 480,
      facingMode: "user",
    },
    audio: false,
  });

  video.srcObject = stream;

  video.addEventListener("loadeddata", () => {
    renderLoop();
  });
}

let lastVideoTime = -1;

function renderLoop() {
  if (video.currentTime !== lastVideoTime) {
    const timeStamp = performance.now();
    const poseLandmarkerResults = poseLandmarker.detectForVideo(
      video,
      timeStamp
    );
    processPose(poseLandmarkerResults);
    lastVideoTime = video.currentTime;
  }
  requestAnimationFrame(renderLoop);
}

function processPose(results) {
  if (results.landmarks.length > 0) {
    const landmarks = results.landmarks[0];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    console.log(landmarks);
    const leftWristDisplay = document.getElementById("left-wrist");
    const rightWristDisplay = document.getElementById("right-wrist");
    leftWristDisplay.textContent = `Left wrist x: ${leftWrist.x.toFixed(2)} y: ${leftWrist.y.toFixed(2)}`
    rightWristDisplay.textContent = `Right wrist x: ${rightWrist.x.toFixed(2)} y: ${rightWrist.y.toFixed(2)}`
  }
}
startCamera();
