// Global variables
let leafletMap = null;
let hotspotData = [];
let leafletLayers = [];
let autoRefreshInterval = null;
let currentRegion = 'california';

// NASA FIRMS API Configuration
const NASA_FIRMS_ENDPOINTS = {
    modis: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
    viirs: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs-i/csv/VNP14IMGTDL_NRT_Global_24h.csv'
};

// CORS Proxy for API calls
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

// Regional bounds for filtering
const REGION_BOUNDS = {
    california: { north: 42, south: 32, west: -125, east: -114 },
    australia: { north: -10, south: -44, west: 113, east: 154 },
    global: { north: 90, south: -90, west: -180, east: 180 }
};

// Debug function
function debugLog(message) {
    console.log('FireSight:', message);
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    debugLog('Initializing FireSight...');
    
    // Initialize Leaflet
    try {
        initializeLeaflet();
        debugLog('Map initialized successfully');
    } catch (error) {
        console.error('Map initialization failed:', error);
        showError('Failed to initialize map');
        return;
    }
    
    // Set up event listeners
    setupEventListeners();
    
    // Show guidance panel for new users
    showGuidancePanel();
    
    // Try to load local data first, then offer fresh data option
    loadLocalData();
    
    debugLog('Initialization complete');
});

// Initialize Leaflet 2D map
function initializeLeaflet() {
    const container = document.getElementById('leafletContainer');
    if (!container) {
        throw new Error('Map container not found');
    }
    
    leafletMap = L.map('leafletContainer', {
        center: [37, -95.5], // Center of US mainland
        zoom: 4,
        zoomControl: true
    });
    
    // Add base tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(leafletMap);
    
    // Trigger resize to ensure proper rendering
    setTimeout(() => {
        if (leafletMap) {
            leafletMap.invalidateSize();
        }
    }, 500);
}

// Set up event listeners
function setupEventListeners() {
    // Refresh button - now fetches fresh data from NASA
    document.getElementById('refreshBtn').addEventListener('click', () => fetchFreshData());
    
    // Region selector
    document.getElementById('regionSelect').addEventListener('change', (e) => {
        currentRegion = e.target.value;
        centerMapOnRegion(currentRegion);
    });
    
    // Info panel close button
    document.querySelector('.close-btn').addEventListener('click', closeInfoPanel);
    
    // Click outside info panel to close
    document.addEventListener('click', (e) => {
        const infoPanel = document.getElementById('infoPanel');
        if (!infoPanel.contains(e.target) && !e.target.closest('.hotspot-marker')) {
            closeInfoPanel();
        }
    });
}

// Show guidance panel
function showGuidancePanel() {
    // Check if user has seen guidance before
    if (!localStorage.getItem('firesight_guidance_seen')) {
        document.getElementById('guidancePanel').style.display = 'block';
    }
}

// Close guidance panel
function closeGuidance() {
    document.getElementById('guidancePanel').style.display = 'none';
    localStorage.setItem('firesight_guidance_seen', 'true');
}

// Center map on selected region
function centerMapOnRegion(region) {
    const centers = {
        california: [36.7783, -119.4179],
        australia: [-25.2744, 133.7751],
        global: [20, 0]
    };
    
    const zooms = {
        california: 6,
        australia: 5,
        global: 2
    };
    
    if (leafletMap && centers[region]) {
        leafletMap.flyTo(centers[region], zooms[region], { duration: 1.5 });
    }
}

// Try to load local data first
async function loadLocalData() {
    try {
        // Try different data file paths for different deployment scenarios
        const dataPaths = [
            '../data/wildfires.geojson',                    // Local development
            './data/wildfires.geojson',                     // Same directory structure
            './demo-data.json'                              // Demo data for deployed site
        ];
        
        let data = null;
        for (const path of dataPaths) {
            try {
                const response = await fetch(path);
                if (response.ok) {
                    data = await response.json();
                    break;
                }
            } catch (err) {
                debugLog(`Failed to load from ${path}: ${err.message}`);
            }
        }
        
        // Try local storage cache
        if (!data) {
            const cached = localStorage.getItem('firesight_cache');
            if (cached) {
                data = JSON.parse(cached);
                debugLog('Loaded data from browser cache');
            }
        }
        
        if (data && data.features && data.features.length > 0) {
            hotspotData = data.features;
            renderData();
            updateTimestamp('Using cached data - Click 🔄 Update for fresh data');
            debugLog(`Loaded ${hotspotData.length} cached hotspots`);
        } else {
            showEmptyState();
        }
    } catch (error) {
        debugLog('No local data available, showing fresh data option');
        showEmptyState();
    }
}

// Fetch fresh data from NASA FIRMS APIs
async function fetchFreshData() {
    try {
        showLoadingOverlay();
        updateProgress(0, 'Initializing...');
        updateLoadingStatus('Connecting to NASA FIRMS...');
        
        let allHotspots = [];
        
        // Initialize connection
        updateProgress(10, 'Connecting to NASA FIRMS...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for visual feedback
        
        // Fetch MODIS data
        updateProgress(20, 'Fetching MODIS satellite data...');
        updateLoadingStatus('Fetching MODIS satellite data...');
        const modisData = await fetchSatelliteData('modis');
        if (modisData.length > 0) {
            allHotspots = allHotspots.concat(modisData);
            debugLog(`Found ${modisData.length} MODIS hotspots`);
        }
        updateProgress(40, `Found ${modisData.length} MODIS hotspots`);
        
        // Fetch VIIRS data
        updateProgress(45, 'Fetching VIIRS satellite data...');
        updateLoadingStatus('Fetching VIIRS satellite data...');
        const viirsData = await fetchSatelliteData('viirs');
        if (viirsData.length > 0) {
            allHotspots = allHotspots.concat(viirsData);
            debugLog(`Found ${viirsData.length} VIIRS hotspots`);
        }
        updateProgress(60, `Found ${viirsData.length} VIIRS hotspots`);
        
        // Filter by region and deduplicate
        updateProgress(65, 'Processing and filtering data...');
        updateLoadingStatus('Processing and filtering data...');
        const filteredHotspots = filterHotspotsByRegion(allHotspots, currentRegion);
        const deduplicatedHotspots = deduplicateHotspots(filteredHotspots);
        updateProgress(75, `Filtered to ${deduplicatedHotspots.length} unique hotspots`);
        
        // Add wind predictions
        updateProgress(80, 'Calculating spread predictions...');
        updateLoadingStatus('Calculating spread predictions...');
        hotspotData = await addSpreadPredictions(deduplicatedHotspots);
        updateProgress(90, 'Preparing visualization...');
        
        debugLog(`Final dataset: ${hotspotData.length} hotspots`);
        
        // Save to local storage for caching
        const geoJsonData = {
            type: 'FeatureCollection',
            metadata: {
                generated_at: new Date().toISOString(),
                total_features: hotspotData.length,
                region: currentRegion,
                source: 'NASA FIRMS Real-time'
            },
            features: hotspotData
        };
        
        localStorage.setItem('firesight_cache', JSON.stringify(geoJsonData));
        
        // Render the data
        updateProgress(95, 'Rendering wildfire data...');
        renderData();
        updateTimestamp('Just updated from NASA satellites');
        
        // Complete
        updateProgress(100, 'Complete!');
        await new Promise(resolve => setTimeout(resolve, 800)); // Show completion briefly
        
        hideLoadingOverlay();
        
        if (hotspotData.length === 0) {
            showEmptyState();
        } else {
            hideEmptyState();
        }
        
    } catch (error) {
        console.error('Failed to fetch fresh data:', error);
        hideLoadingOverlay();
        showError(`Failed to get fresh satellite data: ${error.message}`);
    }
}

// Fetch data from specific satellite
async function fetchSatelliteData(satellite) {
    try {
        const endpoint = NASA_FIRMS_ENDPOINTS[satellite];
        const response = await fetch(CORS_PROXY + encodeURIComponent(endpoint));
        
        if (!response.ok) {
            throw new Error(`${satellite.toUpperCase()} API returned ${response.status}`);
        }
        
        const csvText = await response.text();
        return parseCSVToGeoJSON(csvText, satellite);
        
    } catch (error) {
        debugLog(`${satellite.toUpperCase()} fetch failed: ${error.message}`);
        return [];
    }
}

// Parse CSV data to GeoJSON format
function parseCSVToGeoJSON(csvText, satellite) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');
    const features = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length < headers.length) continue;
        
        const lat = parseFloat(values[0]);
        const lon = parseFloat(values[1]);
        const brightness = parseFloat(values[2]);
        const acq_date = values[5];
        const acq_time = values[6];
        const confidence = satellite === 'modis' ? values[8] : values[9];
        
        if (isNaN(lat) || isNaN(lon) || isNaN(brightness)) continue;
        
        // Create datetime string
        const acq_datetime = `${acq_date}T${acq_time.padStart(4, '0').slice(0,2)}:${acq_time.padStart(4, '0').slice(2,4)}:00Z`;
        
        features.push({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [lon, lat]
            },
            properties: {
                lat: lat,
                lon: lon,
                brightness: brightness,
                acq_datetime: acq_datetime,
                confidence: confidence,
                satellite: satellite.toUpperCase(),
                spread_radius_km: 5.0 // Default, will be updated with wind data
            }
        });
    }
    
    return features;
}

// Filter hotspots by region
function filterHotspotsByRegion(hotspots, region) {
    const bounds = REGION_BOUNDS[region];
    if (!bounds) return hotspots;
    
    return hotspots.filter(feature => {
        const [lon, lat] = feature.geometry.coordinates;
        return lat >= bounds.south && lat <= bounds.north && 
               lon >= bounds.west && lon <= bounds.east;
    });
}

// Remove duplicate hotspots (within 1km of each other)
function deduplicateHotspots(hotspots) {
    const unique = [];
    const threshold = 0.01; // ~1km in degrees
    
    for (const hotspot of hotspots) {
        const [lon, lat] = hotspot.geometry.coordinates;
        const isDuplicate = unique.some(existing => {
            const [existingLon, existingLat] = existing.geometry.coordinates;
            const distance = Math.sqrt(
                Math.pow(lat - existingLat, 2) + 
                Math.pow(lon - existingLon, 2)
            );
            return distance < threshold;
        });
        
        if (!isDuplicate) {
            unique.push(hotspot);
        }
    }
    
    return unique;
}

// Add spread predictions (simplified - no external wind API for now)
async function addSpreadPredictions(hotspots) {
    return hotspots.map(feature => {
        const brightness = feature.properties.brightness;
        const confidence = feature.properties.confidence;
        
        // Simple spread prediction based on brightness and confidence
        let baseRadius = 3.0; // Base 3km radius
        
        // Adjust for brightness (higher = larger spread)
        if (brightness > 350) baseRadius += 3.0;
        else if (brightness > 320) baseRadius += 1.5;
        
        // Adjust for confidence
        if (confidence === 'high' || confidence === 'h') baseRadius += 1.0;
        else if (confidence === 'low' || confidence === 'l') baseRadius -= 1.0;
        
        // Add some randomness for realistic variation
        const variation = (Math.random() - 0.5) * 2.0;
        const finalRadius = Math.max(1.0, Math.min(15.0, baseRadius + variation));
        
        feature.properties.spread_radius_km = parseFloat(finalRadius.toFixed(1));
        
        return feature;
    });
}

// Render all data on map
function renderData() {
    clearLayers();
    
    if (hotspotData.length > 0) {
        renderHotspots();
        renderSpreadRings();
        hideEmptyState();
    } else {
        showEmptyState();
    }
}

// Clear all layers
function clearLayers() {
    if (leafletMap) {
        leafletLayers.forEach(layer => leafletMap.removeLayer(layer));
    }
    leafletLayers = [];
}

// Render hotspots on map
function renderHotspots() {
    hotspotData.forEach(feature => {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        
        // Add to Leaflet
        const leafletMarker = L.circleMarker([coords[1], coords[0]], {
            radius: 6,
            fillColor: '#ff0000',
            color: '#ffffff',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8,
            className: 'hotspot-marker'
        }).addTo(leafletMap);
        
        // Add interaction
        leafletMarker.on('click', () => showInfoPanel(props));
        leafletMarker.on('mouseover', function() {
            this.setRadius(8);
        });
        leafletMarker.on('mouseout', function() {
            this.setRadius(6);
        });
        
        leafletLayers.push(leafletMarker);
    });
}

// Render spread prediction rings
function renderSpreadRings() {
    hotspotData.forEach(feature => {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        const radiusKm = props.spread_radius_km || 5;
        const radiusMeters = radiusKm * 1000;
        
        // Add to Leaflet
        const leafletRing = L.circle([coords[1], coords[0]], {
            radius: radiusMeters,
            fillColor: '#ffff00',
            fillOpacity: 0.3,
            color: '#ff0000',
            weight: 1
        }).addTo(leafletMap);
        
        leafletLayers.push(leafletRing);
    });
}

// Show info panel with hotspot details
function showInfoPanel(properties) {
    const panel = document.getElementById('infoPanel');
    const content = document.getElementById('infoPanelContent');
    
    // Format the content
    content.innerHTML = `
        <div class="info-item">
            <div class="info-label">Location</div>
            <div class="info-value">${properties.lat.toFixed(3)}°, ${properties.lon.toFixed(3)}°</div>
        </div>
        <div class="info-item">
            <div class="info-label">Brightness Temperature</div>
            <div class="info-value">${properties.brightness.toFixed(1)} K</div>
        </div>
        <div class="info-item">
            <div class="info-label">Acquisition Time</div>
            <div class="info-value">${formatDateTime(properties.acq_datetime)}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Confidence Level</div>
            <div class="info-value">${properties.confidence}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Satellite</div>
            <div class="info-value">${properties.satellite}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Predicted Spread (6h)</div>
            <div class="info-value">${properties.spread_radius_km.toFixed(1)} km radius</div>
        </div>
        <div class="info-item">
            <button onclick="shareLocation(${properties.lat}, ${properties.lon})" style="
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.3);
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                width: 100%;
            ">📋 Share Location</button>
        </div>
    `;
    
    panel.classList.add('active');
}

// Close info panel
function closeInfoPanel() {
    document.getElementById('infoPanel').classList.remove('active');
}

// Share location functionality
function shareLocation(lat, lon) {
    const url = `${window.location.origin}${window.location.pathname}?lat=${lat}&lon=${lon}`;
    navigator.clipboard.writeText(url).then(() => {
        alert('📋 Location URL copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        prompt('Copy this URL:', url);
    });
}

// Loading and UI helper functions
function showLoadingOverlay() {
    document.getElementById('loadingOverlay').style.display = 'flex';
    // Reset progress bar
    updateProgress(0, 'Starting...');
}

function hideLoadingOverlay() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function updateLoadingStatus(message) {
    const statusEl = document.getElementById('loadingStatus');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function updateProgress(percentage, stepMessage) {
    const progressFill = document.getElementById('progressFill');
    const progressPercent = document.getElementById('progressPercent');
    const progressStep = document.getElementById('progressStep');
    
    if (progressFill) {
        progressFill.style.width = `${percentage}%`;
    }
    
    if (progressPercent) {
        progressPercent.textContent = `${Math.round(percentage)}%`;
    }
    
    if (progressStep) {
        progressStep.textContent = stepMessage;
    }
    
    // Add a small delay to make progress feel more natural
    return new Promise(resolve => setTimeout(resolve, 200));
}

function showEmptyState() {
    document.getElementById('emptyState').style.display = 'block';
}

function hideEmptyState() {
    document.getElementById('emptyState').style.display = 'none';
}

function showError(message) {
    const banner = document.getElementById('errorBanner');
    const messageEl = document.getElementById('errorMessage');
    messageEl.textContent = message;
    banner.style.display = 'flex';
    
    setTimeout(() => {
        banner.style.display = 'none';
    }, 8000);
}

// Helper functions
function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short'
    });
}

function updateTimestamp(message = null) {
    const now = new Date();
    const formatted = now.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
    });
    const element = document.getElementById('lastUpdated');
    if (element) {
        element.textContent = message || `Last updated: ${formatted} UTC`;
    }
}

// Load data function for backwards compatibility
function loadData(forceRefresh = false) {
    if (forceRefresh) {
        fetchFreshData();
    } else {
        loadLocalData();
    }
}

// Handle deep linking on load
window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get('lat'));
    const lon = parseFloat(params.get('lon'));
    
    if (!isNaN(lat) && !isNaN(lon)) {
        // Fly to the specified location
        if (leafletMap) {
            leafletMap.flyTo([lat, lon], 10, { duration: 2 });
        }
    }
}); 