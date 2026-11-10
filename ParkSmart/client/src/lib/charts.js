import {
  Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);
ChartJS.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
ChartJS.defaults.color = '#6b5d4d';

// Categorical slots in fixed order (validated: lightness band, chroma, CVD separation).
// Colour follows the entity: each vehicle type always keeps its hue.
export const TYPE_COLORS = { motorcycle: '#2a78d6', car: '#eb6834', microbus: '#1baf7a' };
export const METHOD_COLORS = { cash: '#2a78d6', online: '#eb6834', pass: '#1baf7a' };
export const ACCENT = '#a86f2c';

export const baseOptions = (yLabel) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 600 },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.96)', titleColor: '#2b2118', bodyColor: '#4f4234', borderColor: 'rgba(120,88,50,.2)',
      borderWidth: 1, padding: 10, cornerRadius: 10, boxPadding: 4,
    },
  },
  scales: {
    x: { grid: { display: false }, border: { color: 'rgba(120,88,50,.2)' } },
    y: {
      beginAtZero: true, grid: { color: 'rgba(120,88,50,.08)' }, border: { display: false },
      title: yLabel ? { display: true, text: yLabel, color: '#6b5d4d' } : undefined, ticks: { precision: 0 },
    },
  },
});

export const barStyle = { borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 28, borderColor: 'rgba(255,255,255,0.9)', borderWidth: { top: 0, left: 1, right: 1, bottom: 0 } };
