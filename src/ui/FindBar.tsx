import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { IconButton } from './IconButton';
import { colors } from './theme';

/** Barra de "buscar en esta página". */
export function FindBar({
  found,
  onSearch,
  onClose,
}: {
  found: boolean | null;
  onSearch: (text: string, opts: { backwards?: boolean; reset?: boolean }) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const input = useRef<TextInput>(null);

  useEffect(() => {
    // El teclado se abre solo: si abriste la barra es para escribir.
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.bar}>
      <TextInput
        ref={input}
        style={styles.input}
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (v) onSearch(v, { reset: true });
        }}
        onSubmitEditing={() => text && onSearch(text, {})}
        placeholder="Buscar en esta página"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {text.length > 0 && found === false && <Text style={styles.none}>sin resultados</Text>}
      <IconButton
        name="chevron.up"
        size={17}
        disabled={!text}
        onPress={() => onSearch(text, { backwards: true })}
      />
      <IconButton
        name="chevron.down"
        size={17}
        disabled={!text}
        onPress={() => onSearch(text, {})}
      />
      <IconButton name="xmark" size={16} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 12,
    paddingRight: 4,
    paddingBottom: 8,
  },
  input: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
  },
  none: { color: colors.textDim, fontSize: 12, paddingHorizontal: 6 },
});
