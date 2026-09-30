<?php
/**
 * Een nagebootste mailserver, om de mails van de site te testen zonder dat er
 * echt iets de deur uitgaat.
 *
 *   php tools/nep-smtp-server.php [poort] [map] [certificaat.pem]
 *
 * Luistert op 127.0.0.1 (standaard poort 2525), accepteert elke login, en
 * schrijft elke mail als .eml-bestand in de map (standaard de tijdelijke map
 * van het systeem). Geef je een PEM-bestand met certificaat en sleutel mee,
 * dan kan hij ook STARTTLS. Zet in je lokale cubetimer_config.php:
 *
 *   'mail' => ['host' => '127.0.0.1', 'port' => 2525, 'encryption' => 'none',
 *              'username' => 'test', 'password' => 'test',
 *              'from' => 'noreply@cubetimer.nl'],
 *
 * (met certificaat: 'encryption' => 'tls', 'verify_peer' => false)
 */
declare(strict_types=1);

$poort = (int) ($argv[1] ?? 2525);
$map = rtrim($argv[2] ?? sys_get_temp_dir(), '/');
$certificaat = $argv[3] ?? null;

$context = stream_context_create($certificaat ? ['ssl' => ['local_cert' => $certificaat, 'verify_peer' => false]] : []);
$server = stream_socket_server("tcp://127.0.0.1:$poort", $fout, $tekst, STREAM_SERVER_BIND | STREAM_SERVER_LISTEN, $context);
if ($server === false) {
    fwrite(STDERR, "Kan niet luisteren op $poort: $tekst\n");
    exit(1);
}
echo "Nep-SMTP luistert op 127.0.0.1:$poort, mails gaan naar $map\n";

$teller = 0;
while (true) {
    $klant = @stream_socket_accept($server, -1);
    if ($klant === false) {
        continue;
    }
    stream_set_timeout($klant, 30);
    $zeg = static fn (string $regel) => fwrite($klant, $regel . "\r\n");

    $zeg('220 nep-smtp klaar');
    $van = '';
    $aan = [];
    $ingelogd = false;
    $versleuteld = false;
    $authStap = 0;

    while (($regel = fgets($klant)) !== false) {
        $regel = rtrim($regel, "\r\n");

        if ($authStap === 1) { $authStap = 2; $zeg('334 UGFzc3dvcmQ6'); continue; }
        if ($authStap === 2) { $authStap = 0; $ingelogd = true; $zeg('235 ingelogd'); continue; }

        $opdracht = strtoupper(strtok($regel, ' '));
        if ($opdracht === 'EHLO' || $opdracht === 'HELO') {
            $zeg('250-nep-smtp');
            if ($certificaat && !$versleuteld) {
                $zeg('250-STARTTLS');
            }
            $zeg('250 AUTH LOGIN');
        } elseif ($opdracht === 'STARTTLS' && $certificaat) {
            $zeg('220 ga je gang');
            $versleuteld = stream_socket_enable_crypto($klant, true, STREAM_CRYPTO_METHOD_TLS_SERVER);
        } elseif ($opdracht === 'AUTH') {
            $authStap = 1;
            $zeg('334 VXNlcm5hbWU6');
        } elseif ($opdracht === 'MAIL') {
            $van = $regel;
            $zeg('250 ok');
        } elseif ($opdracht === 'RCPT') {
            $aan[] = $regel;
            $zeg('250 ok');
        } elseif ($opdracht === 'DATA') {
            $zeg('354 einde met een punt');
            $bericht = '';
            while (($r = fgets($klant)) !== false && rtrim($r, "\r\n") !== '.') {
                $bericht .= str_starts_with($r, '..') ? substr($r, 1) : $r;
            }
            $teller++;
            $bestand = sprintf('%s/nep-smtp-%d-%d.eml', $map, getmypid(), $teller);
            file_put_contents($bestand, $bericht);
            echo date('H:i:s') . " mail $teller: $van -> " . implode(', ', $aan)
                . ($ingelogd ? ' (ingelogd)' : '') . ($versleuteld ? ' (TLS)' : '') . " -> $bestand\n";
            $zeg('250 bewaard');
        } elseif ($opdracht === 'QUIT') {
            $zeg('221 dag');
            break;
        } else {
            $zeg('250 ok');
        }
    }
    fclose($klant);
}
