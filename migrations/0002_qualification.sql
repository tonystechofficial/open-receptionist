-- The discovery journey's answers about the caller's business (2026-10-27): JSON with entreprise,
-- activite, offre, situation, appels_manques and echeance, only those the call gave.
ALTER TABLE calls ADD COLUMN qualification TEXT;
