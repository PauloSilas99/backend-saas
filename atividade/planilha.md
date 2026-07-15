Você é responsável pelo backend do fluxo de importação de planilha do nosso SaaS de gestão de ações/outorgas. Stack: Express + TypeScript + Prisma + BullMQ (Redis) + arquitetura modular por domínio. O código relacionado a esse fluxo já vive (ou deve viver) em src/modules/imports/, seguindo o mesmo padrão dos outros módulos do projeto: imports.controller.ts, imports.service.ts, imports.repository.ts, imports.routes.ts, imports.schemas.ts, além de imports.queue.ts e imports.worker.ts para o processamento assíncrono.

Ajuste/implemente o fluxo completo abaixo, sempre isolando os dados por empresa (multi-tenant: toda leitura/gravação deve ser filtrada e associada ao empresaId do usuário autenticado, nunca vazando dados entre empresas diferentes).

1. UPLOAD (POST /imports)
   - Receber o arquivo via multer, com limits.fileSize configurado (ex: 10MB) e fileFilter checando mimetype como primeira barreira (não confiar só nisso).
   - Validar a assinatura binária real do arquivo (magic bytes) usando a lib file-type, rejeitando qualquer arquivo cujo tipo real não seja xlsx/xls/csv, independente da extensão enviada.
   - Se for .xlsx (formato ZIP), checar o tamanho total descomprimido antes de processar, para prevenir zip bomb (ex: limite de 200MB descomprimido).
   - Salvar o arquivo original (disco local em dev, S3 ou equivalente em produção) para fins de auditoria — nunca descartar o arquivo enviado.
   - Criar um registro no banco representando o "job de importação" (tabela ex: import_jobs) com status inicial "pending", empresaId, usuarioId, nome do arquivo original, caminho/referência do arquivo salvo, timestamp.
   - Adicionar um job na fila BullMQ (imports.queue.ts) referenciando o importJobId, e responder imediatamente com 202 Accepted e o jobId — não processar a planilha de forma síncrona na requisição.

2. WORKER — PARSE (imports.worker.ts, primeira etapa)
   - Consumir o job da fila, atualizar status para "processing".
   - Fazer o parse do arquivo com exceljs (preferencialmente via streaming, para não carregar arquivos grandes inteiros em memória) ou xlsx/SheetJS para arquivos menores.
   - Envolver o parse em try/catch tratando arquivo corrompido/ilegível, atualizando o status do job para "error" com uma mensagem clara caso falhe, sem derrubar o worker.
   - Extrair cabeçalhos (primeira linha) e as demais linhas como dados brutos.
   - Validar estrutura mínima: existe pelo menos uma linha de dados além do cabeçalho, existe algum cabeçalho não vazio, número de linhas dentro de um limite máximo razoável (definir constante, ex: 50.000 linhas — acima disso, considerar erro ou processamento em lotes/chunks).
   - Persistir os cabeçalhos detectados e as linhas brutas (ou uma referência a elas) associados ao importJobId, e atualizar status para "ready_for_mapping".

3. MAPEAMENTO DE COLUNAS
   - GET /imports/:jobId/columns: retornar os cabeçalhos detectados e a lista de campos do sistema disponíveis para mapeamento (definidos a partir do schema Prisma dos modelos de destino — ex: funcionário, outorga, plano). Se possível, sugerir automaticamente um mapeamento (comparação de string aproximada entre cabeçalho da planilha e nome/label do campo do sistema).
   - POST /imports/:jobId/mapping: receber o mapeamento definido pelo usuário (coluna da planilha → campo do sistema), validar via schema (Zod) que todos os campos obrigatórios foram mapeados, persistir o mapeamento associado ao job, e então disparar (via fila novamente, se o volume justificar) a etapa de validação linha a linha.

4. VALIDAÇÃO LINHA A LINHA
   - Para cada linha, aplicar o mapeamento e validar: tipos de dado corretos (datas, números), campos obrigatórios preenchidos, formatos válidos (e-mail, CPF se aplicável), duplicidade dentro da própria planilha, e conflito/duplicidade com dados já existentes no banco para aquela empresa (ex: funcionário com mesmo e-mail já cadastrado — decidir se isso é erro bloqueante ou se deve gerar uma atualização/merge, e deixar essa regra explícita no código).
   - Persistir o resultado da validação por linha (status ok/erro/aviso + mensagem) associado ao job, sem ainda gravar nas tabelas definitivas do domínio (funcionários, outorgas etc.) — nada é gravado como dado real até a confirmação.
   - Atualizar status do job para "ready_for_preview" (ou equivalente) e expor GET /imports/:jobId/preview retornando as linhas processadas com seus status, paginado (não retornar 50 mil linhas de uma vez).

5. CONFIRMAÇÃO / COMMIT (POST /imports/:jobId/confirm)
   - Checar se o job pertence à empresa do usuário autenticado (nunca confiar em jobId vindo do cliente sem essa checagem).
   - Rodar o commit dentro de uma transação Prisma (prisma.$transaction), gravando as linhas válidas nas tabelas definitivas do domínio. Se qualquer parte crítica falhar, tudo deve dar rollback — não deixar o banco com importação parcial. Decidir e documentar a política de linhas com erro: são ignoradas silenciosamente (permitindo importação parcial do que é válido) ou bloqueiam a confirmação inteira — implemente da forma configurável se possível, mas deixe explícito qual é o comportamento padrão.
   - Se o volume de linhas for grande, esse commit também deve rodar via fila/worker, não bloqueando a requisição HTTP.
   - Ao concluir, atualizar status do job para "completed" (ou "completed_with_errors"), registrar quantidade de registros importados/ignorados, e disponibilizar esse resultado em GET /imports/:jobId.

6. HISTÓRICO
   - GET /imports: listar jobs de importação da empresa do usuário autenticado (nunca de outras empresas), com paginação, status, data, usuário que iniciou.
   - GET /imports/:jobId: detalhe completo de um job específico, incluindo link/referência para o arquivo original armazenado (para auditoria).

Requisitos técnicos transversais:
- Toda rota deve passar por middleware de autenticação e verificar que o recurso acessado (jobId) pertence à empresa (empresaId) do usuário autenticado — isolamento multi-tenant é inegociável.
- Validação de payload de entrada em todas as rotas via Zod (seguindo o padrão *.schemas.ts já usado nos outros módulos).
- Nenhum processamento pesado (parse, validação em massa, commit em massa) deve rodar de forma síncrona numa requisição HTTP — tudo que for potencialmente lento vai para BullMQ.
- Logar cada etapa do processamento do job (parse iniciado/concluído, validação iniciada/concluída, commit iniciado/concluído) para permitir debug e auditoria.
- Escrever testes (Vitest) cobrindo pelo menos: rejeição de arquivo com mimetype forjado, planilha corrompida, planilha sem colunas obrigatórias mapeadas, linha com dado inválido sendo corretamente marcada como erro no preview, e isolamento entre empresas diferentes (uma empresa não pode acessar job de outra).

Me pergunte se precisar confirmar o schema Prisma exato dos modelos de destino (funcionários, outorgas, planos) antes de implementar o commit — não invente campos que não existem no schema atual.