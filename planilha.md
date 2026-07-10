Como a planilha é salva hoje
O fluxo tem 2 etapas:

1) Upload (POST /imports/spreadsheet)
Arquivo vai para a pasta uploads/
Backend lê com xlsx
Valida colunas e normaliza linhas
Salva um registro em imports com:
metadados do arquivo
preview_data (JSON com as linhas)
error_report (erros por linha)
status PREVIEW
Ainda não cria as ações finais
2) Confirmação (POST /imports/spreadsheet/confirm)
Aí sim persiste de verdade:

Cria (ou reutiliza) um action_plans
Para cada linha válida, faz upsert em action_plan_rows
Atualiza o imports com status COMPLETED / PARTIAL / FAILED
Mapeamento linha → banco
Coluna da planilha	Campo no banco (action_plan_rows)
titulo
title
descricao
description
status
status (PENDING, IN_PROGRESS...)
prioridade
priority (LOW, HIGH...)
responsavel
responsible_name + responsible_id (se achar usuário)
unidade
unit_name + unit_id (se achar unidade)
prazo
due_date
chave
external_key (idempotência)
Estrutura final:

imports
  └── action_plans          (1 plano gerado/vinculado)
        └── action_plan_rows (1 linha da planilha = 1 ação)
Ou seja: a planilha vira plano de ação + lista de ações, não um workflow executável.

Passos para automatizar a execução do fluxo
Hoje o sistema só cadastra. Para automatizar, o caminho natural seria:

1. Modelar o processo
Definir entidades como:

workflow_templates (modelo do fluxo)
workflow_steps (etapas: abrir → executar → aprovar → concluir)
workflow_instances (execução de um processo)
workflow_transitions / regras (quando avança, quem aprova, SLA)
2. Ligar importação ao workflow
No confirm, além de criar action_plan_rows:

criar uma workflow_instance por linha (ou por plano)
colocar no passo inicial (PENDING / “atribuído”)
3. Criar motor de transição
Um service tipo WorkflowEngine com regras:

“ao concluir etapa A → abre etapa B”
“se atrasar → escala para gestor”
“se prioridade crítica → notifica admin”
4. Eventos e jobs
ao criar ação: notificar responsável
job diário: marcar atrasadas / escalar
ao mudar status: disparar próxima etapa
opcional: fila (BullMQ/Redis) para processar assíncrono
5. APIs de execução
Além de CRUD, endpoints como:

POST /workflows/:id/start
POST /workflows/:id/advance
POST /workflows/:id/approve
POST /workflows/:id/reject
6. Auditoria e dashboard
Registrar cada transição e alimentar analytics com tempo por etapa, gargalos, SLA.

Resumo
Salvamento atual: arquivo → imports (preview) → confirmação → action_plans + action_plan_rows
Automação: ainda não existe; precisaria de modelo de etapas + motor de regras + eventos/jobs