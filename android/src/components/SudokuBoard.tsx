import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { board as B, colors } from '@/theme';
import type { Cell } from '@/types/api';

export interface SudokuBoardProps {
  values: number[][];
  fixed: boolean[][];
  selected: Cell | null;
  /** "row,col" keys (zero-based) the BACKEND reported as duplicates */
  conflicts: ReadonlySet<string>;
  onSelect: (cell: Cell) => void;
  /** outer width/height in dp */
  size: number;
}

const OUTER = 3;
const thick = 2;
const thin = 1;

export function cellLabel(r: number, c: number, v: number, fixed: boolean, conflict: boolean): string {
  return `Row ${r + 1}, column ${c + 1}, ${v ? `value ${v}` : 'empty'}${fixed ? ', clue' : ''}${conflict ? ', conflicts with another cell' : ''}`;
}

/** Peers of the selected cell: same row, column or 2x2 box (pure geometry, no Sudoku rules). */
function isPeer(sel: Cell | null, r: number, c: number): boolean {
  if (!sel) return false;
  const [sr, sc] = sel;
  return sr === r || sc === c || (Math.floor(sr / 2) === Math.floor(r / 2) && Math.floor(sc / 2) === Math.floor(c / 2));
}

export function SudokuBoard({ values, fixed, selected, conflicts, onSelect, size }: SudokuBoardProps) {
  const cell = Math.floor((size - OUTER * 2) / 4);
  const inner = cell * 4;
  return (
    <View
      testID="sudoku-board"
      accessibilityRole="grid"
      style={[styles.outer, { width: inner + OUTER * 2, height: inner + OUTER * 2 }]}
    >
      {values.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((v, c) => {
            const conflict = conflicts.has(`${r},${c}`);
            const isSel = !!selected && selected[0] === r && selected[1] === c;
            const peer = !isSel && isPeer(selected, r, c);
            const bg = conflict ? B.conflictBg : isSel ? B.selected : peer ? B.peer : B.background;
            const textColor = conflict ? B.conflictText : fixed[r][c] ? B.clueText : B.userText;
            return (
              <Pressable
                key={c}
                testID={`cell-${r}-${c}`}
                accessibilityRole="button"
                accessibilityLabel={cellLabel(r, c, v, fixed[r][c], conflict)}
                accessibilityState={{ selected: isSel }}
                onPress={() => onSelect([r, c])}
                style={[
                  styles.cell,
                  {
                    width: cell,
                    height: cell,
                    backgroundColor: bg,
                    borderRightWidth: c === 3 ? 0 : c === 1 ? thick : thin,
                    borderBottomWidth: r === 3 ? 0 : r === 1 ? thick : thin,
                    borderRightColor: c === 1 ? B.boxLine : B.cellLine,
                    borderBottomColor: r === 1 ? B.boxLine : B.cellLine,
                  },
                ]}
              >
                {isSel && <View pointerEvents="none" style={styles.ring} />}
                {v !== 0 && (
                  <Text
                    testID={`cell-text-${r}-${c}`}
                    style={{ fontSize: cell * 0.52, color: textColor, fontWeight: fixed[r][c] ? '800' : '500' }}
                  >
                    {v}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { borderWidth: OUTER, borderColor: B.boxLine, backgroundColor: B.background, borderRadius: 6, overflow: 'hidden', alignSelf: 'center' },
  row: { flexDirection: 'row' },
  cell: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 3, borderColor: colors.accentStrong },
});
