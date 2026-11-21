import { createRoot } from 'react-dom/client';
import { ReplayDemo } from './demo';

const root = document.getElementById('root');
if (!root) throw new Error('Корневой элемент реплея не найден');
createRoot(root).render(<ReplayDemo />);
