let video;

let faceMesh;
let faceOptions = { maxFaces: 1, refineLandmarks: false, flipped: false };
let faces = [];

let handPose;
let handOptions = { maxHands: 2 };
let hands = [];

async function setup() {
  createCanvas(640, 480);
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  faceMesh = await ml5.faceMesh(faceOptions);
  faceMesh.detectStart(video, (results) => (faces = results));

  handPose = await ml5.handPose(handOptions);
  handPose.detectStart(video, (results) => (hands = results));
}

function draw() {
  background(220);
  image(video, 0, 0);

  if (faces.length > 0) {
    for (let face of faces) {
      for (let keypoint of face.keypoints) {
        fill(0, 255, 0);
        noStroke();
        circle(keypoint.x, keypoint.y, 5);
      }
    }
  }

  if (hands.length > 0) {
    for (let hand of hands) {
      for (let keypoint of hand.keypoints) {
        fill(255, 0, 0);
        noStroke();
        circle(keypoint.x, keypoint.y, 10);
      }
    }
  }
}
