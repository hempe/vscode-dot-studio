import { createRoot } from 'react-dom/client';
import { App, PublishApi } from './App';

declare function acquireVsCodeApi(): PublishApi;

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App api={acquireVsCodeApi()} />);
}
