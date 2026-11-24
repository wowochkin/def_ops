import { createRoot } from 'react-dom/client';
import { PreparationWorkspace } from '../../src/modern/kshvi/preparation/PreparationWorkspace';
import '../../src/modern/kshvi/kshvi.css';

createRoot(document.getElementById('root')!).render(<div className="modern-kshvi"><PreparationWorkspace /></div>);
