class VideoProcessor {
    constructor() {
        this.initializeElements();
        this.initializeVariables();
        this.setupEventListeners();
        this.loadBodyPix();
    }

    initializeElements() {
        this.videoElement = document.getElementById('videoElement');

        // Create debug container
        this.debugContainer = document.createElement('div');
        this.debugContainer.style.position = 'absolute';
        this.debugContainer.style.top = '10px';
        this.debugContainer.style.left = '10px';
        this.debugContainer.style.background = 'rgba(0,0,0,0.7)';
        this.debugContainer.style.color = 'white';
        this.debugContainer.style.padding = '10px';
        this.debugContainer.style.borderRadius = '5px';
        this.debugContainer.style.zIndex = '3';
        this.videoElement.parentNode.appendChild(this.debugContainer);

        // Create two canvases - one for display and one for processing
        this.displayCanvas = document.createElement('canvas');
        this.processCanvas = document.createElement('canvas');

        // Style display canvas
        this.displayCanvas.style.position = 'absolute';
        this.displayCanvas.style.top = '0';
        this.displayCanvas.style.left = '0';
        this.displayCanvas.style.width = '100%';
        this.displayCanvas.style.height = '100%';
        this.displayCanvas.style.zIndex = '2';

        // Add canvas to DOM
        this.videoElement.parentNode.insertBefore(this.displayCanvas, this.videoElement.nextSibling);

        // Get contexts
        this.displayCtx = this.displayCanvas.getContext('2d');
        this.processCtx = this.processCanvas.getContext('2d');

        // Create overlay for showing segmentation
        this.segmentationOverlay = document.createElement('canvas');
        this.segmentationOverlay.style.position = 'absolute';
        this.segmentationOverlay.style.top = '0';
        this.segmentationOverlay.style.left = '0';
        this.segmentationOverlay.style.width = '100%';
        this.segmentationOverlay.style.height = '100%';
        this.segmentationOverlay.style.zIndex = '1';
        this.overlayCtx = this.segmentationOverlay.getContext('2d');
        this.videoElement.parentNode.insertBefore(this.segmentationOverlay, this.displayCanvas);
    }

    initializeVariables() {
        this.bodyPixNet = null;
        this.isProcessing = false;
        this.fgSpeed = 1;
        this.bgSpeed = 1;
        this.selectedArea = 'foreground';
        this.lastProcessTime = 0;
        this.debugMode = true; // Enable debug visualization
    }

    async loadBodyPix() {
        try {
            this.updateDebug('Loading BodyPix model...');
            this.bodyPixNet = await bodyPix.load({
                architecture: 'ResNet50', // Using more accurate model
                outputStride: 16,
                quantBytes: 2
            });
            this.updateDebug('BodyPix model loaded successfully!');
        } catch (error) {
            console.error('Error loading BodyPix:', error);
            this.updateDebug('Error loading BodyPix model!');
            alert('Error initializing video processor. Please try again.');
        }
    }

    updateDebug(message) {
        this.debugContainer.textContent = `Status: ${message}
        FG Speed: ${this.fgSpeed}x
        BG Speed: ${this.bgSpeed}x
        Selected: ${this.selectedArea}`;
    }

    setupEventListeners() {
        // Add debug toggle button
        const debugBtn = document.createElement('button');
        debugBtn.textContent = 'Toggle Debug View';
        debugBtn.style.marginTop = '10px';
        document.querySelector('.controls').appendChild(debugBtn);
        debugBtn.addEventListener('click', () => {
            this.debugMode = !this.debugMode;
            this.segmentationOverlay.style.display = this.debugMode ? 'block' : 'none';
        });

        // Modify existing speed control handlers
        document.getElementById('selectForeground').addEventListener('click', () => {
            this.selectedArea = 'foreground';
            this.fgSpeed = parseFloat(speedSlider.value);
            this.updateDebug('Foreground selected');
            this.updateSpeedDisplay();
        });

        document.getElementById('selectBackground').addEventListener('click', () => {
            this.selectedArea = 'background';
            this.bgSpeed = parseFloat(speedSlider.value);
            this.updateDebug('Background selected');
            this.updateSpeedDisplay();
        });

        speedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            if (this.selectedArea === 'foreground') {
                this.fgSpeed = speed;
            } else {
                this.bgSpeed = speed;
            }
            this.updateSpeedDisplay();
            this.updateDebug(`Speed changed: ${speed}x`);
        });
    }

    updateSpeedDisplay() {
        const speed = this.selectedArea === 'foreground' ? this.fgSpeed : this.bgSpeed;
        speedValue.textContent = `${speed.toFixed(1)}x (${this.selectedArea})`;
    }

    async startProcessing() {
        if (!this.bodyPixNet) {
            await this.loadBodyPix();
        }

        // Set canvas dimensions
        const width = this.videoElement.videoWidth;
        const height = this.videoElement.videoHeight;
        this.displayCanvas.width = width;
        this.displayCanvas.height = height;
        this.processCanvas.width = width;
        this.processCanvas.height = height;
        this.segmentationOverlay.width = width;
        this.segmentationOverlay.height = height;

        this.isProcessing = true;
        this.videoElement.play();
        this.processFrame();
    }

    stopProcessing() {
        this.isProcessing = false;
        this.videoElement.pause();
    }

    async processFrame() {
        if (!this.isProcessing) return;

        try {
            // Get person segmentation
            const segmentation = await this.bodyPixNet.segmentPerson(this.videoElement, {
                flipHorizontal: false,
                internalResolution: 'medium',
                segmentationThreshold: 0.7
            });

            // Draw original frame
            this.displayCtx.drawImage(this.videoElement, 0, 0);

            // Get frame data
            const imageData = this.displayCtx.getImageData(
                0, 0,
                this.displayCanvas.width,
                this.displayCanvas.height
            );

            // Apply speed effects
            this.applySpeedEffects(imageData, segmentation);

            // Draw processed frame
            this.displayCtx.putImageData(imageData, 0, 0);

            // Visualize segmentation if debug mode is on
            if (this.debugMode) {
                const maskImage = bodyPix.toMask(
                    segmentation, { r: 0, g: 255, b: 0, a: 100 }, // Foreground color
                    { r: 0, b: 255, g: 0, a: 100 } // Background color
                );

                bodyPix.drawMask(
                    this.segmentationOverlay,
                    this.videoElement,
                    maskImage,
                    0.7
                );
            }

            // Calculate and apply speed-based time advancement
            const now = performance.now();
            const fgDelta = (1000 / 30) / this.fgSpeed;
            const bgDelta = (1000 / 30) / this.bgSpeed;

            // Use the dominant speed for the current frame
            const dominantSpeed = this.getDominantSpeed(segmentation);
            const timeIncrement = (1 / 30) * dominantSpeed;

            if (now - this.lastProcessTime >= Math.min(fgDelta, bgDelta)) {
                this.lastProcessTime = now;
                this.videoElement.currentTime += timeIncrement;
            }

            this.updateDebug(`Processing: FG=${this.fgSpeed}x, BG=${this.bgSpeed}x`);
            requestAnimationFrame(() => this.processFrame());

        } catch (error) {
            console.error('Frame processing error:', error);
            this.updateDebug('Error processing frame!');
            this.stopProcessing();
        }
    }

    getDominantSpeed(segmentation) {
        // Count foreground vs background pixels
        const fgPixels = segmentation.data.filter(x => x).length;
        const totalPixels = segmentation.data.length;
        const fgRatio = fgPixels / totalPixels;

        // Return weighted average of speeds
        return (fgRatio * this.fgSpeed) + ((1 - fgRatio) * this.bgSpeed);
    }

    applySpeedEffects(imageData, segmentation) {
        const pixels = imageData.data;
        const mask = segmentation.data;

        for (let i = 0; i < mask.length; i++) {
            const pixelIndex = i * 4;
            const isForeground = mask[i];

            const speed = isForeground ? this.fgSpeed : this.bgSpeed;

            if (speed > 1) {
                // Add motion blur effect
                const blurFactor = (speed - 1) * 0.1;

                // Apply different effects to foreground and background
                if (isForeground) {
                    // Foreground effect - sharper motion blur
                    pixels[pixelIndex] = Math.min(255, pixels[pixelIndex] * (1 + blurFactor));
                    pixels[pixelIndex + 1] = Math.min(255, pixels[pixelIndex + 1] * (1 + blurFactor));
                    pixels[pixelIndex + 2] = Math.min(255, pixels[pixelIndex + 2] * (1 + blurFactor));
                } else {
                    // Background effect - softer blur
                    pixels[pixelIndex] = Math.min(255, pixels[pixelIndex] * (1 + blurFactor * 0.7));
                    pixels[pixelIndex + 1] = Math.min(255, pixels[pixelIndex + 1] * (1 + blurFactor * 0.7));
                    pixels[pixelIndex + 2] = Math.min(255, pixels[pixelIndex + 2] * (1 + blurFactor * 0.7));
                }
            }
        }
    }
}

// Initialize processor when video is loaded
fileInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const fileURL = URL.createObjectURL(file);
        videoElement.src = fileURL;
        videoElement.onloadedmetadata = function() {
            fileInputContainer.classList.add('hidden');
            videoControls.classList.remove('hidden');

            // Initialize video processor
            window.videoProcessor = new VideoProcessor();
        };
    }
});

// Modify play/pause button handler
playPauseBtn.addEventListener('click', function() {
    if (!window.videoProcessor) return;

    if (videoElement.paused) {
        window.videoProcessor.startProcessing();
        playPauseBtn.textContent = 'Pause';
    } else {
        window.videoProcessor.stopProcessing();
        playPauseBtn.textContent = 'Play';
    }
});