import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DealCardComments } from '@/modules/leads/components/deal-card/DealCardComments';
import { validateCommentFiles, MAX_COMMENT_FILE_SIZE } from '@/modules/leads/lib/comment-attachments/files';

const pdf = () => new File(['%PDF-1.4 document'], 'proposta.pdf', { type: 'application/pdf' });
afterEach(cleanup);
describe('Documentos nos comentários do negócio', () => {
 it('envia documento sem exigir texto e só limpa depois do sucesso', async () => {
  let done!: () => void;
  const send = vi.fn(() => new Promise<void>(resolve => { done = resolve; }));
  render(<DealCardComments comentarios={[]} onComentar={send} />);
  const file = pdf();
  fireEvent.change(screen.getByLabelText('Selecionar documentos'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', {name: 'Comentar'}));
  expect(send).toHaveBeenCalledWith('', [file]);
  expect(screen.getByRole('button', {name: 'Comentar'})).toBeDisabled();
  expect(screen.getByText('proposta.pdf')).toBeInTheDocument();
  done();
  await waitFor(() => expect(screen.queryByText('proposta.pdf')).not.toBeInTheDocument());
 });
 it('mantém documentos e texto se a publicação falhar', async () => {
  const send = vi.fn().mockRejectedValue(new Error('offline'));
  render(<DealCardComments comentarios={[]} onComentar={send} />);
  fireEvent.change(screen.getByLabelText('Escrever comentário'), {target: {value: 'Segue proposta'}});
  fireEvent.change(screen.getByLabelText('Selecionar documentos'), {target: {files: [pdf()]}});
  fireEvent.click(screen.getByRole('button', {name: 'Comentar'}));
  await waitFor(() => expect(screen.getByRole('button', {name: 'Comentar'})).not.toBeDisabled());
  expect(screen.getByLabelText('Escrever comentário')).toHaveValue('Segue proposta');
  expect(screen.getByText('proposta.pdf')).toBeInTheDocument();
 });
 it('permite remover antes de publicar e rejeita formato não permitido', () => {
  render(<DealCardComments comentarios={[]} onComentar={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Selecionar documentos'), {target: {files: [pdf()]}});
  fireEvent.click(screen.getByRole('button', {name: 'Remover proposta.pdf'}));
  expect(screen.getByRole('button', {name: 'Comentar'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Selecionar documentos'), {target: {files: [new File(['x'], 'script.html')]}});
  expect(screen.getByRole('alert')).toHaveTextContent('Formato não permitido');
 });
 it('baixa pelo callback privado e informa erro de acesso sem perder o comentário', async () => {
  const attachment = {path: 'private/file',name: 'proposta.pdf',size: 100,type: 'application/pdf'};
  const download = vi.fn().mockRejectedValue(new Error('403'));
  render(<DealCardComments onBaixarAnexo={download} comentarios={[{id:'c',corpo:'Proposta',autor:'Ana',autorAvatar:null,criadoEm:'2026-09-10T10:00:00Z',editadoEm:null,deOutroNegocio:null,podeEditar:false,podeApagar:false,anexos:[attachment]}]} />);
  fireEvent.click(screen.getByRole('button',{name:'Baixar proposta.pdf'}));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível baixar'));
  expect(download).toHaveBeenCalledWith(attachment);
 });
 it('valida quantidade, tamanho e nomes no limite', () => {
  expect(() => validateCommentFiles(Array.from({length:6},pdf))).toThrow('5 arquivos');
  const large = pdf(); Object.defineProperty(large,'size',{value:MAX_COMMENT_FILE_SIZE+1});
  expect(() => validateCommentFiles([large])).toThrow('20 MB');
  expect(() => validateCommentFiles([new File([], 'empty.pdf')])).toThrow();
  expect(() => validateCommentFiles([new File(['x'], 'nome\u202e.pdf')])).toThrow('Nome');
  expect(() => validateCommentFiles([pdf()])).not.toThrow();
 });
});
