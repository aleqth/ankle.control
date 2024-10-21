let ankleImg;
let referenceImg;
let tileSize = 50; // Initial tile size
let slider; // Slider to control the number of ankles
let smoothFactor; // Factor for smoothing transitions
let contrastFactor; // Factor to adapt based on image complexity

function preload() {
  ankleImg = loadImage('ankle no hand.png'); // Load your ankle image
  referenceImg = loadImage('mona.jpg'); // Load the reference image
}

function setup() {
  // Dynamically resize the canvas based on window size
  let aspectRatio = referenceImg.width / referenceImg.height;
  let canvasWidth = min(windowWidth, 1000); // Limit the width to a max of 1000px
  let canvasHeight = canvasWidth / aspectRatio; // Adjust height based on the image's aspect ratio

  createCanvas(canvasWidth, canvasHeight);
  imageMode(CENTER);

  // Create a responsive slider to control the tile size
  slider = createSlider(10, 80, 50); // Min 10 (more ankles), Max 80 (fewer ankles), Initial 50
  slider.position(10, canvasHeight + 10); // Position the slider below the canvas
  slider.style('width', canvasWidth * 0.8 + 'px'); // Adjust the slider width based on the canvas size

  noLoop(); // No looping for performance reasons
}

function draw() {
  background(255);

  // Adjust tileSize dynamically based on the slider value
  tileSize = slider.value();

  // Resize the reference image to fit the canvas dimensions while keeping the aspect ratio
  referenceImg.resize(width, height);
  referenceImg.loadPixels();

  // Smooth scaling factor for consistent sizing
  smoothFactor = map(tileSize, 10, 80, 1.5, 0.5);

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

// Redraw when slider changes value
function mouseReleased() {
  redraw(); // Redraw the canvas whenever the slider value changes
}

// Make canvas resize dynamically when window size changes (for mobile responsiveness)
function windowResized() {
  let aspectRatio = referenceImg.width / referenceImg.height;
  let canvasWidth = min(windowWidth, 1000); // Limit the width to a max of 1000px
  let canvasHeight = canvasWidth / aspectRatio;
  resizeCanvas(canvasWidth, canvasHeight);
  slider.position(10, canvasHeight + 10);
  slider.style('width', canvasWidth * 0.8 + 'px');
}
