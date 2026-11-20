import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { SudokuBoard } from '@/components/SudokuBoard';
import { board as B } from '@/theme';

const values = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]];
const fixed = values.map((r) => r.map((v) => v !== 0));
const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

describe('SudokuBoard', () => {
  const renderBoard = async (over: Partial<React.ComponentProps<typeof SudokuBoard>> = {}) =>
    render(<SudokuBoard values={values} fixed={fixed} selected={null} conflicts={new Set()} onSelect={() => undefined} size={320} {...over} />);

  it('renders 16 cells with the digits it was given', async () => {
    await renderBoard();
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) expect(screen.getByTestId(`cell-${r}-${c}`)).toBeTruthy();
    expect(screen.getByTestId('cell-text-0-2').props.children).toBe(3);
    expect(screen.queryByTestId('cell-text-0-0')).toBeNull();
  });

  it('draws thicker, darker lines on the 2x2 box boundaries only', async () => {
    await renderBoard();
    expect(style('cell-0-1').borderRightWidth).toBeGreaterThan(style('cell-0-0').borderRightWidth);
    expect(style('cell-0-1').borderRightColor).toBe(B.boxLine);
    expect(style('cell-1-0').borderBottomWidth).toBeGreaterThan(style('cell-0-0').borderBottomWidth);
    expect(style('cell-0-0').borderRightColor).toBe(B.cellLine);
    expect(style('cell-0-3').borderRightWidth).toBe(0);   // outer edge is drawn by the board border
    expect(style('cell-2-1').borderBottomWidth).toBe(1);
  });

  it('distinguishes fixed clues from user values', async () => {
    const f = fixed.map((r) => r.slice());
    f[0][2] = false;
    await renderBoard({ fixed: f });
    expect(StyleSheet.flatten(screen.getByTestId('cell-text-0-2').props.style)).toMatchObject({ color: B.userText, fontWeight: '500' });
    expect(StyleSheet.flatten(screen.getByTestId('cell-text-0-3').props.style)).toMatchObject({ color: B.clueText, fontWeight: '800' });
  });

  it('highlights the selected cell and its row, column and 2x2 box', async () => {
    await renderBoard({ selected: [1, 1] });
    expect(style('cell-1-1').backgroundColor).toBe(B.selected);
    for (const id of ['cell-1-0', 'cell-1-3', 'cell-0-1', 'cell-3-1', 'cell-0-0']) expect(style(id).backgroundColor).toBe(B.peer);  // row, col, box
    expect(style('cell-3-3').backgroundColor).toBe(B.background);
    expect(style('cell-0-2').backgroundColor).toBe(B.background);
  });

  it('marks backend-reported conflicts and exposes them to assistive tech', async () => {
    await renderBoard({ conflicts: new Set(['0,2', '0,3']) });
    expect(style('cell-0-2').backgroundColor).toBe(B.conflictBg);
    expect(StyleSheet.flatten(screen.getByTestId('cell-text-0-2').props.style).color).toBe(B.conflictText);
    expect(screen.getByTestId('cell-0-2').props.accessibilityLabel).toContain('conflicts with another cell');
    expect(screen.getByTestId('cell-0-0').props.accessibilityLabel).toBe('Row 1, column 1, empty');
    expect(screen.getByTestId('cell-0-3').props.accessibilityLabel).toContain('clue');
  });

  it('reports the pressed cell with zero-based coordinates', async () => {
    const onSelect = jest.fn();
    await renderBoard({ onSelect });
    await fireEvent.press(screen.getByTestId('cell-2-3'));
    expect(onSelect).toHaveBeenCalledWith([2, 3]);
  });

  it.each([240, 288, 320, 380])('fits its container at %d dp (small-screen layout)', async (size) => {
    await renderBoard({ size });
    const s = StyleSheet.flatten(screen.getByTestId('sudoku-board').props.style);
    expect(s.width).toBeLessThanOrEqual(size);
    expect(s.width).toBe(s.height);
    const cell = style('cell-0-0');
    expect(cell.width).toBeGreaterThanOrEqual(Math.floor((size - 6) / 4));
    expect(cell.width).toBeGreaterThanOrEqual(48 * (size >= 240 ? 1 : 1) - 4);   // touch target stays near/above 48dp
  });
});
