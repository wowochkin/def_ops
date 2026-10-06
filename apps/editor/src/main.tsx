import { createRoot } from 'react-dom/client';
import '../demo/fonts';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
document.fonts.ready.then(() => document.body.setAttribute('data-ready', '1'));
