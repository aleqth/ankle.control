let ankleImg;
let referenceImg;
let tileSize = 40; // Default tile size
let smoothFactor; // Factor for controlling smoothness
let contrastFactor; // Factor for adapting based on image complexity
let fileInput, controlSlider; // For image upload and controlling density
let capturer;
let capturing = false;
let userImage; // To track the uploaded image

function preload() {
  ankleImg = loadImage('ankle_no_hand.png'); // Load your ankle image
  referenceImg = loadImage('mona.jpg'); // Default reference image
}

function setup() {
  // Dynamically resize the canvas based on window size
  let aspectRatio = referenceImg.width / referenceImg.height;
  let canvasWidth = min(windowWidth, 1000); // Limit width to max 1000px
  let canvasHeight = canvasWidth / aspectRatio; // Adjust height based on aspect ratio

  createCanvas(canvasWidth, canvasHeight);
  imageMode(CENTER);
  
  // Create input for image upload
  fileInput = select('#upload');
  fileInput.changed(handleFileUpload);

  // Create slider to control density/tightness
  controlSlider = select('#controlSlider');
  controlSlider.input(updateControl);

  noLoop(); // No continuous looping for performance reasons
}

// Called when a user uploads an image
function handleFileUpload() {
  const file = fileInput.elt.files[0];
  if (file) {
    const imgURL = URL.createObjectURL(file);
    userImage = loadImage(imgURL, img => {
      referenceImg = img; // Set the uploaded image as the reference
      resizeCanvasAccordingToImage();
      redraw(); // Redraw the canvas with the new image
    });
  }
}

// Resize canvas based on the aspect ratio of the uploaded image
function resizeCanvasAccordingToImage() {
  let aspectRatio = referenceImg.width / referenceImg.height;
  let canvasWidth = min(windowWidth, 1000);
  let canvasHeight = canvasWidth / aspectRatio;
  resizeCanvas(canvasWidth, canvasHeight);
}

// Called when the slider value changes (controls tightness/density)
function updateControl() {
  tileSize = int(controlSlider.value()); // Update tile size based on slider
  redraw(); // Redraw with new tile size
}

function draw() {
  background(255);

  // Resize the reference image to fit the canvas dimensions
  referenceImg.resize(width, height);
  referenceImg.loadPixels();

  // Smooth scaling factor for consistent sizing
  smoothFactor = map(tileSize, 1, 80, 1.5, 0.5); // Controlled behavior to the right

  // Loop over the pixels of the reference image to place "ankle" images
  for (let y = 0; y < referenceImg.height; y += tileSize) {
    for (let x = 0; x < referenceImg.width; x += tileSize) {
      let index = (x + y * referenceImg.width) * 4;
      let r = referenceImg.pixels[index];
      let g = referenceImg.pixels[index + 1];
      let b = referenceImg.pixels[index + 2];
      let brightnessValue = (r + g + b) / 3;

      // Adaptive ankle size based on brightness
      let size = map(brightnessValue, 0, 255, tileSize * smoothFactor * 1.2, tileSize * smoothFactor * 0.6);

      // Calculate local contrast (difference in brightness from surrounding pixels)
      let contrast = calculateContrast(referenceImg, x, y, tileSize);
      contrastFactor = map(contrast, 0, 255, 1.0, 0.7); // Higher contrast areas adapt more

      size *= contrastFactor; // Adjust the size further based on contrast

      let angle = map(brightnessValue, 0, 255, -PI / 8, PI / 8); // Minimal randomness for smoother flow

      // Minimal randomness for placement
      let xOffset = random(-tileSize * 0.05, tileSize * 0.05);
      let yOffset = random(-tileSize * 0.05, tileSize * 0.05);

      // Draw the ankle image at the corresponding position
      push();
      translate(x + xOffset + tileSize / 2, y + yOffset + tileSize / 2);
      rotate(angle);
      image(ankleImg, 0, 0, size, size); // Draw the ankle image
      pop();
    }
  }
}

// Function to calculate contrast at a specific pixel location
function calculateContrast(img, x, y, tileSize) {
  let brightnessCenter = getBrightness(img, x, y);
  let brightnessRight = getBrightness(img, x + tileSize, y);
  let brightnessDown = getBrightness(img, x, y + tileSize);
  let contrast = abs(brightnessCenter - brightnessRight) + abs(brightnessCenter - brightnessDown);
  return contrast;
}

// Helper function to get the brightness at a specific pixel
function getBrightness(img, x, y) {
  if (x >= 0 && x < img.width && y >= 0 && y < img.height) {
    let index = (x + y * img.width) * 4;
    let r = img.pixels[index];
    let g = img.pixels[index + 1];
    let b = img.pixels[index + 2];
    return (r + g + b) / 3;
  }
  return 0; // If outside bounds, return 0 brightness
}
