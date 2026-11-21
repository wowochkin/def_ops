// @vitest-environment happy-dom
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {CopySource} from '../src/modern/CopySource';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('отдельная кнопка копирует адрес и сообщает об успехе после записи',async()=>{const write=vi.fn().mockResolvedValue(undefined);vi.spyOn(navigator,'clipboard','get').mockReturnValue({writeText:write} as unknown as Clipboard);render(<CopySource url="https://openfreemap.org/" name="Источник"/>);fireEvent.click(screen.getByRole('button',{name:'Копировать ссылку: Источник'}));await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Ссылка скопирована'));expect(write).toHaveBeenCalledWith('https://openfreemap.org/');});
it('при отказе буфера даёт выделяемый адрес, не сообщает ложный успех',async()=>{vi.spyOn(navigator,'clipboard','get').mockReturnValue({writeText:vi.fn().mockRejectedValue(Error('denied'))} as unknown as Clipboard);render(<CopySource url="https://openfreemap.org/" name="Источник"/>);fireEvent.click(screen.getByRole('button'));expect(await screen.findByLabelText('Адрес: Источник')).toBeTruthy();});
