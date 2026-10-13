import { createRoot } from 'react-dom/client';
import { App, ErrorListApi } from './App';

declare function acquireVsCodeApi(): ErrorListApi;

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App api={acquireVsCodeApi()} />);
}
