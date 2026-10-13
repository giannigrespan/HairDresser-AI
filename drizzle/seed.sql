-- Dati di esempio: adattali al salone (si possono rieseguire, non sovrascrivono modifiche manuali).
INSERT INTO servizi (nome, durata_min, buffer_min, prezzo, note) VALUES
  ('Taglio', 45, 15, 25, 'include shampoo'),
  ('Piega', 30, 10, 15, NULL),
  ('Taglio e piega', 60, 15, 35, NULL),
  ('Colore', 120, 0, 60, 'ricrescita'),
  ('Colore e taglio', 150, 15, 80, NULL)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO impostazioni (chiave, valore) VALUES
  ('nome_salone', 'Salone Bella'),
  ('id_calendario', 'SOSTITUISCI@group.calendar.google.com'),
  ('orari', '{"lunedi":[],"martedi":[["09:00","13:00"],["15:00","19:00"]],"mercoledi":[["09:00","13:00"],["15:00","19:00"]],"giovedi":[["09:00","13:00"],["15:00","19:00"]],"venerdi":[["09:00","13:00"],["15:00","19:00"]],"sabato":[["09:00","17:00"]],"domenica":[]}'),
  ('giorni_chiusura', '["2026-12-25","2026-12-26","2027-01-01"]'),
  ('anticipo_min', '120'),
  ('orizzonte_giorni', '21'),
  ('passo_min', '30'),
  ('telefono_titolare', '+390000000000')
ON CONFLICT (chiave) DO NOTHING;
