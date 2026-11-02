// the Zed LiveServer extension is not loading MediaPipe files correctly
// either switch to VS Code with its LiveServer extension... or, in Zed:
// change directory in Terminal to mp_example with "cd mp_example" command
// then, launch server with:
// "python3 -m http.server 8000" on macOS
// "python -m http.server 8000" on Windows
// then, open your browser window at 127.0.0.1:8000

import {
  FilesetResolver,
  FaceLandmarker,
  HandLandmarker,
  GestureRecognizer
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
);

const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "./models/face_landmarker.task",
  },
  runningMode: "VIDEO",
  numFaces: 1,
});

const handLandmarker = await HandLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "./models/hand_landmarker.task",
  },
  runningMode: "VIDEO",
  numHands: 1,
});

const gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "./models/gesture_recognizer.task"
  },
  runningMode: "VIDEO",
  numHands: 1
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
    const faceLandmarkerResults = faceLandmarker.detectForVideo(
      video,
      timeStamp
    );
    const handLandmarkerResults = handLandmarker.detectForVideo(
      video,
      timeStamp
    );
    const gestureRecognizerResults = gestureRecognizer.recognizeForVideo(
      video,
      timeStamp
    );
    processFace(faceLandmarkerResults);
    processHands(handLandmarkerResults);
    processGesture(gestureRecognizerResults);
    lastVideoTime = video.currentTime;
  }
  requestAnimationFrame(renderLoop);
}

function processFace(results) {
  if (results.faceLandmarks.length > 0) {
    const face = results.faceLandmarks[0];
    const topLip = face[468];
    const bottomLip = face[473];
    document.getElementById("top-lip").textContent = `0: ${topLip.y}`;
    document.getElementById("bottom-lip").textContent = `17: ${bottomLip.y}`;
  }
}

function processHands(results) {
  if (results.landmarks.length > 0) {
    const hand = results.landmarks[0];
    const thumbTip = hand[4];
    const indexTip = hand[8];
    document.getElementById("thumb-tip").textContent =
      `4: ${thumbTip.x}, ${thumbTip.y}`;
    document.getElementById("index-tip").textContent =
      `8: ${indexTip.x}, ${indexTip.y}`;
  }
}

function processGesture(results) {
  if (results.gestures.length > 0) {
    const gesture = results.gestures[0][0];
    const gestureType = gesture.categoryName;
    document.getElementById("gesture-type").textContent = gestureType;
  }
}

startCamera();
