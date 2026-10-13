import { createRoot } from 'react-dom/client';
import { App, WizardApi } from './App';

declare function acquireVsCodeApi(): WizardApi;

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App api={acquireVsCodeApi()} />);
}
