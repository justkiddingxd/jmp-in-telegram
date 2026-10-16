#!/bin/sh
# удаляет из Mnesia ejabberd пароли в открытом виде (тип plain) у аккаунтов, у которых уже есть SCRAM-запись.
# ejabberd с auth_stored_password_types: [scram_sha1] сам их не удаляет, а при входе использует SCRAM.
# порядок для сервера, где аккаунты уже есть:
#   docker compose up -d ejabberd                                   # с auth_stored_password_types в конфиге
#   docker compose exec ejabberd ejabberdctl convert_to_scram "$XMPP_DOMAIN"   # добавит SCRAM-записи
#   docker compose cp ejabberd/drop-plain-passwords.sh ejabberd:/tmp/
#   docker compose exec ejabberd sh /tmp/drop-plain-passwords.sh  # уберёт plain
set -e
ERL=$(ls -d /opt/ejabberd-*/erts-*/bin/erl | head -1)
BOOT=$(ls /opt/ejabberd-*/releases/*/start_clean.boot | head -1)
NODE=${ERLANG_NODE:-ejabberd@localhost}
exec "$ERL" -boot "${BOOT%.boot}" -boot_var RELEASE_LIB "${BOOT%/releases/*}/lib" -noshell -sname "pwfix$$@localhost" -setcookie "$(cat /opt/ejabberd/.erlang.cookie)" -eval "
  Node = '$NODE',
  Keys = rpc:call(Node, mnesia, dirty_all_keys, [passwd]),
  Plain = [K || {U, S, plain} = K <- Keys, lists:member({U, S, sha}, Keys)],
  [ok = rpc:call(Node, mnesia, dirty_delete, [passwd, K]) || K <- Plain],
  Left = length([K || {_, _, plain} = K <- Keys]) - length(Plain),
  io:format(\"plain-паролей удалено: ~p, осталось без SCRAM: ~p~n\", [length(Plain), Left]),
  init:stop()."
