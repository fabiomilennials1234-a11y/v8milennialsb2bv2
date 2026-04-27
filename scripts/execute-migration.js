#!/usr/bin/env node
/**
 * Script para executar migration SQL no Supabase
 * Requer: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carregar variáveis de ambiente
config({ path: join(__dirname, '../.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('❌ Erro: SUPABASE_URL não encontrado no .env');
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Erro: SUPABASE_SERVICE_ROLE_KEY não encontrado no .env');
  console.error('   Para executar migrations, você precisa da service_role key do Supabase.');
  console.error('   Encontre em: Supabase Dashboard > Settings > API > service_role key');
  process.exit(1);
}

// Criar cliente Supabase com service_role (bypassa RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function executeMigration() {
  const migrationFile = join(__dirname, '../supabase/migrations/20260128000000_add_user_separation_complete.sql');
  
  console.log('📄 Lendo arquivo de migration...');
  const sql = readFileSync(migrationFile, 'utf-8');
  
  // Dividir SQL em comandos individuais (separados por ;)
  // Remover comentários e linhas vazias
  const commands = sql
    .split(';')
    .map(cmd => cmd.trim())
    .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'))
    .filter(cmd => !cmd.match(/^\s*$/));
  
  console.log(`📦 Encontrados ${commands.length} comandos SQL para executar...`);
  console.log('🚀 Executando migration...\n');
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i] + ';'; // Adicionar ; de volta
    
    try {
      // Executar via RPC ou query direta
      const { data, error } = await supabase.rpc('exec_sql', { sql_query: command });
      
      if (error) {
        // Tentar método alternativo: usar query direta via PostgREST
        // Para DDL, precisamos usar a API REST diretamente
        console.log(`⚠️  Comando ${i + 1}/${commands.length}: Tentando método alternativo...`);
        
        // Usar fetch direto para executar SQL
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({ sql_query: command })
        });
        
        if (!response.ok) {
          // Se não houver função RPC, tentar executar via connection string direta
          console.log(`⚠️  Comando ${i + 1}/${commands.length}: Não foi possível executar via API REST`);
          console.log(`   Comando: ${command.substring(0, 100)}...`);
          errorCount++;
          continue;
        }
        
        successCount++;
        if ((i + 1) % 10 === 0) {
          console.log(`✅ Progresso: ${i + 1}/${commands.length} comandos executados`);
        }
      } else {
        successCount++;
        if ((i + 1) % 10 === 0) {
          console.log(`✅ Progresso: ${i + 1}/${commands.length} comandos executados`);
        }
      }
    } catch (err) {
      console.error(`❌ Erro no comando ${i + 1}:`, err.message);
      errorCount++;
    }
  }
  
  console.log('\n📊 Resumo:');
  console.log(`   ✅ Sucesso: ${successCount}`);
  console.log(`   ❌ Erros: ${errorCount}`);
  
  if (errorCount > 0) {
    console.log('\n⚠️  Alguns comandos falharam. Execute manualmente no Supabase SQL Editor.');
    process.exit(1);
  } else {
    console.log('\n🎉 Migration executada com sucesso!');
  }
}

executeMigration().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
