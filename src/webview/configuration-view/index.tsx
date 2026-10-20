import { createRoot } from 'react-dom/client';
import { App, ConfigurationManagerApi } from './App';

declare function acquireVsCodeApi(): ConfigurationManagerApi;

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App api={acquireVsCodeApi()} />);
}
