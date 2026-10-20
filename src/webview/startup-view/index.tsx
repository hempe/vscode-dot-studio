import { createRoot } from 'react-dom/client';
import { App, StartupProjectsApi } from './App';

declare function acquireVsCodeApi(): StartupProjectsApi;

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App api={acquireVsCodeApi()} />);
}
