import { createRoot } from 'react-dom/client';
import '../demo/fonts';
import './styles.css';
import { Shell } from './Shell';

createRoot(document.getElementById('root')!).render(<Shell />);
document.fonts.ready.then(() => document.body.setAttribute('data-ready', '1'));
