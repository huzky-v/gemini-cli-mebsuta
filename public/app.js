const dashboard = document.getElementById('dashboard');
const lastUpdatedSpan = document.querySelector('#last-updated span');
const darkModeToggle = document.getElementById('dark-mode-toggle');

const modelColors = {
    'Pro': '#4285F4',
    'Flash': '#34A853',
    '3-Flash': '#FBBC05',
    'Default': '#EA4335'
};

function getModelColor(modelName) {
    return modelColors[modelName] || modelColors['Default'];
}

function toggleDarkMode() {
    if (darkModeToggle.checked) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

function renderMetrics(data) {
    dashboard.innerHTML = '';
    const { metrics, prefer, lastUpdatedTime } = data;

    if (lastUpdatedTime) {
        lastUpdatedSpan.textContent = new Date(lastUpdatedTime).toLocaleString();
    }

    if (!metrics || metrics.length === 0) {
        dashboard.innerHTML = '<p>No metrics available.</p>';
        return;
    }

    metrics.forEach(metric => {
        const metricContainer = document.createElement('div');
        metricContainer.className = 'metric-container';

        const projectInfoContainer = document.createElement('div');
        projectInfoContainer.className = 'project-info';

        const emailElem = document.createElement('div');
        emailElem.className = 'email';
        emailElem.textContent = metric.email || metric.projectId;

        const projectIdElem = document.createElement('div');
        projectIdElem.className = 'project-id';
        // If there's an email, show the project ID, otherwise, the project ID is already in the email element, so leave this empty.
        projectIdElem.textContent = metric.email ? metric.projectId : ''; 

        const emojiSpan = document.createElement('span');
        emojiSpan.style.marginLeft = '5px';

        if (metric.isCurrent) {
            emojiSpan.textContent = '🟢';
            emojiSpan.title = 'Current project';
        } else {
            emojiSpan.textContent = '🔴';
            emojiSpan.title = 'Not current project';
        }
        emailElem.appendChild(emojiSpan);
        
        projectInfoContainer.appendChild(emailElem);
        projectInfoContainer.appendChild(projectIdElem);
        metricContainer.appendChild(projectInfoContainer);

        const row = document.createElement('div');
        row.className = 'metric-row';

        const circleContainer = document.createElement('div');
        circleContainer.className = 'circle-container';

        const legendContainer = document.createElement('div');
        legendContainer.className = 'legend-container';

        let svg = `<svg width="225" height="225" viewBox="0 0 300 300">`;
        
        let radius = 105;
        const strokeWidth = 9;
        let tspanElements = [];
        let modelEntries = [];

        if (metric.models) {
            modelEntries = Object.entries(metric.models);
            modelEntries.forEach(([modelName, modelData]) => {
                const percentage = parseFloat(modelData.remaining); // Use remaining %
                const color = getModelColor(modelName);
                const circumference = 2 * Math.PI * radius;
                const dasharray = (percentage / 100) * circumference;
                const gap = circumference - dasharray;

                svg += `<circle class="circle-bg" cx="150" cy="150" r="${radius}" stroke-width="${strokeWidth}"></circle>`;
                svg += `<circle class="circle-progress" cx="150" cy="150" r="${radius}" stroke="${color}" stroke-dasharray="${dasharray} ${gap}" stroke-width="${strokeWidth}"></circle>`;
                
                tspanElements.push({ text: `${percentage}%`, color: color });

                radius -= (strokeWidth + 2);

                const legendItem = document.createElement('div');
                legendItem.className = 'legend-item';

                const legendColor = document.createElement('div');
                legendColor.className = 'legend-color';
                legendColor.style.backgroundColor = color;

                const legendInfo = document.createElement('div');
                legendInfo.className = 'legend-info';

                const legendModel = document.createElement('div');
                legendModel.className = 'legend-model';
                legendModel.textContent = modelName;
                if (modelData.low_threshold) {
                    legendModel.textContent = modelName + ' ⚠️';
                }

                const legendReset = document.createElement('div');
                legendReset.className = 'legend-reset';
                legendReset.textContent = `Resets in: ${modelData.resets_in}`;

                legendInfo.appendChild(legendModel);
                legendInfo.appendChild(legendReset);

                legendItem.appendChild(legendColor);
                legendItem.appendChild(legendInfo);

                legendContainer.appendChild(legendItem);
            });
        }
        
        // Add single text element in the center with tspans
        if (tspanElements.length > 0) {
            // Calculate initial y to vertically center the text block
            const lineHeight = 24; // Updated to match font-size
            const initialY = 150 - (lineHeight * (tspanElements.length - 1)) / 2;

            svg += `<text x="150" y="${initialY}" class="circle-text">`;
            tspanElements.forEach((tspan, index) => {
                svg += `<tspan x="150" dy="${index === 0 ? 0 : '1.2em'}" fill="${tspan.color}">${tspan.text}</tspan>`;
            });
            svg += `</text>`;
        }

        svg += `</svg>`;
        circleContainer.innerHTML = svg;

        row.appendChild(circleContainer);
        row.appendChild(legendContainer);
        metricContainer.appendChild(row);
        dashboard.appendChild(metricContainer);
    });
}

async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        renderMetrics(data);
    } catch (error) {
        console.error('Error fetching stats:', error);
        dashboard.innerHTML = `<p>Error fetching stats: ${error.message}</p>`;
    }
}

// Dark mode toggle
darkModeToggle.addEventListener('change', toggleDarkMode);

// Initial setup
toggleDarkMode();
fetchStats();
setInterval(fetchStats, 30000);
