# Architecture

## Vue d'ensemble

```
Tablettes Android (SQLite local)  ──HTTPS──▶  Caddy  ──▶  API NestJS  ──▶  PostgreSQL 16
Back-office / console (Next.js)   ──HTTPS──▶  Caddy  ──▶  API NestJS
Headwind MDM (mode kiosque, mises à jour, effacement à distance), sur mdm.<domaine>
```

Tout tourne sur un VPS Contabo avec Docker. Aucun service tiers (ni Vercel, ni Supabase).

## Principes

**La tablette travaille seule.** Chaque tablette a sa propre base locale. Les identifiants (UUID) sont créés sur la tablette, ce qui permet de créer tickets, lignes et paiements sans réseau. Il n'y a pas de tablette maîtresse sur le réseau local : la source commune est le serveur.

**Le serveur fait foi.** Il recalcule les totaux des tickets à partir des lignes, le fond de caisse théorique à la clôture, le numéro de Z, et refuse toute opération contraire aux règles (paiement supérieur au reste dû, annulation sans manager, journée close, etc.).

**Montants en centimes.** Tous les montants sont des entiers (`bigint`, centimes de dirham). Les taux de TVA sont en points de base (1000 = 10 %). Aucun calcul en virgule flottante.

**Isolation par client.** Chaque requête métier s'exécute sous le rôle `caissebox_app` avec `app.tenant_id` fixé pour la transaction ; la Row Level Security de PostgreSQL empêche physiquement de lire ou d'écrire les données d'un autre client, même en cas de bug applicatif.

**Inaltérabilité.** Des triggers interdisent de modifier un ticket payé, une journée clôturée, les paiements, mouvements de caisse, journal d'audit et journal de synchronisation. Toute correction passe par une nouvelle écriture tracée.

## Authentification

| Appelant | Moyen | Durée du jeton |
|---|---|---|
| Tablette | identifiant + secret remis à l'enrôlement (QR code) | 30 jours |
| Propriétaire (back-office) | e-mail + mot de passe | 12 h |
| Opérateur BACYBRAINS (console) | e-mail + mot de passe | 12 h |
| Personnel sur la tablette | PIN à 4 chiffres, vérifié hors ligne | session locale |

Mots de passe et secrets : scrypt salé. PIN : PBKDF2-SHA256 (même code sur serveur et tablette). Un PIN à 4 chiffres reste faible par nature : la protection réelle est le chiffrement de la base locale, le mode kiosque et l'effacement à distance via Headwind MDM.

## Journée d'exploitation

Une journée s'ouvre manuellement (manager + fond de caisse) et peut dépasser minuit ; sa date d'exploitation est celle de l'ouverture (fuseau Africa/Casablanca). Elle ne se clôture que si tous les tickets et toutes les sessions de caisse sont fermés ; le serveur attribue le Z suivant.

## Blocage progressif pour impayé

`establishments.access_state` : `normal` → `warning_manager` → `warning_all` → `refuse_day_open`. Même au dernier niveau, une journée déjà ouverte continue de fonctionner : on ne bloque jamais un service en cours.
