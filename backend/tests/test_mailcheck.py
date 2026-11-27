"""`python -m app.mailcheck`: one test email through the configured relay, with a clear verdict."""

import smtplib

from app import mailcheck


def test_a_working_relay_reports_ok_and_sends_one_message_to_the_address(monkeypatch, capsys, settings):
    sent = []
    monkeypatch.setattr(mailcheck, "deliver", sent.append)
    assert mailcheck.main(["you@example.com"]) == 0
    assert len(sent) == 1 and sent[0]["To"] == "you@example.com" and sent[0]["From"] == settings.smtp_from_email
    assert "OK" in capsys.readouterr().out


def test_a_failing_relay_reports_why_and_exits_non_zero(monkeypatch, capsys):
    def refuse(message):
        raise smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")

    monkeypatch.setattr(mailcheck, "deliver", refuse)
    assert mailcheck.main(["you@example.com"]) == 1
    err = capsys.readouterr().err
    assert "FAILED" in err and "SMTPAuthenticationError" in err and "535" in err


def test_production_with_the_development_mail_catcher_fails_without_trying(monkeypatch, capsys, settings):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "smtp_host", "mailpit")
    monkeypatch.setattr(mailcheck, "deliver", lambda message: (_ for _ in ()).throw(AssertionError("must not send")))
    assert mailcheck.main(["you@example.com"]) == 1
    assert "mailpit" in capsys.readouterr().err


def test_it_needs_exactly_one_address(capsys):
    assert mailcheck.main([]) == 2 and mailcheck.main(["a@x.com", "b@x.com"]) == 2 and mailcheck.main(["not-an-address"]) == 2
    assert "usage" in capsys.readouterr().err
