import sqlite3

conn = sqlite3.connect('alojamento.db')
cur = conn.cursor()

# 1. Update Guarda-roupa / Armário to quantidade 4 in all rooms
cur.execute("UPDATE moveis_itens SET quantidade = 4 WHERE tipo_item LIKE '%Armário%' OR tipo_item LIKE '%Guarda-roupa%'")
print('Updated armarios count:', cur.rowcount)

# 2. Update all Ventilador or other cooling to Ar-Condicionado with quantidade 1 in all rooms
cur.execute("UPDATE moveis_itens SET tipo_item = 'Ar-Condicionado', quantidade = 1 WHERE tipo_item LIKE '%Ventilador%' OR tipo_item LIKE '%Climat%' OR tipo_item LIKE '%Ar-Condicionado%'")
print('Updated ar-condicionado count:', cur.rowcount)

# 3. Ensure Beliche has quantidade 2 in all rooms
cur.execute("UPDATE moveis_itens SET quantidade = 2 WHERE tipo_item LIKE '%Beliche%' OR tipo_item LIKE '%Cama%'")
print('Updated beliches count:', cur.rowcount)

conn.commit()

# Verify breakdown
print('\n=== Verificação dos Móveis por Tipo e Quantidade ===')
cur.execute('SELECT tipo_item, quantidade, count(*) FROM moveis_itens GROUP BY tipo_item, quantidade ORDER BY tipo_item')
for r in cur.fetchall():
    print(r)

conn.close()
print('\nMóveis atualizados com sucesso em todos os quartos: 2 beliches, 4 armários e 1 ar condicionado!')
