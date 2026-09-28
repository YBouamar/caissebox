import { useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { usePosContext } from '../services/CaisseProvider';
import { dh } from './format';
import { Btn, Sheet, T } from './kit';
import { C, F } from './theme';

export function CustomerSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const { pos } = usePosContext();
  const [q, setQ] = useState('');
  const list = visible ? pos.customers(q) : [];
  return (
    <Sheet visible={visible} onClose={onClose} title="Client du ticket" width={640}>
      <TextInput value={q} onChangeText={setQ} placeholder="Nom ou téléphone" placeholderTextColor={C.faint} style={{ height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: C.input, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 16, color: C.ink }} />
      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 8 }}>
        <Btn label="Client divers" height={52} onPress={() => onPick(pos.defaultCustomer().id)} />
        {list.map((c) => (
          <Btn key={c.id} label={`${c.full_name}${c.phone ? ` · ${c.phone}` : ''} · ardoise ${dh(pos.customerBalance(c.id))}`} height={52} onPress={() => onPick(c.id)} />
        ))}
        {list.length === 0 && q ? <T color={C.muted}>Aucun client. Les clients se créent depuis le back-office.</T> : null}
      </ScrollView>
    </Sheet>
  );
}
