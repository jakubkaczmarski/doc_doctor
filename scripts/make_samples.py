"""Generate synthetic 'scanned' documents for testing: slightly rotated, noisy images."""
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

out = sys.argv[1]
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def page(lines, seed):
    random.seed(seed)
    img = Image.new("RGB", (1654, 2339), "white")  # A4 at 200 dpi
    d = ImageDraw.Draw(img)
    y = 140
    for text, size, bold, x in lines:
        d.text((x, y), text, fill=(25, 25, 30), font=ImageFont.truetype(BOLD if bold else ARIAL, size))
        y += int(size * 1.7)
    img = img.rotate(random.uniform(-1.2, 1.2), resample=Image.BICUBIC, fillcolor="white")
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    arr = np.asarray(img).astype(np.int16) + np.random.default_rng(seed).normal(0, 9, (2339, 1654, 3))
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


L = 150
invoice = [
    ("FAKTURA VAT nr FV/2026/10/0417", 44, True, L),
    ("Data wystawienia: 14.10.2026        Termin płatności: 28.10.2026", 28, False, L),
    ("", 20, False, L),
    ("Sprzedawca: Hurtownia Papiernicza Żuraw Sp. z o.o.", 30, True, L),
    ("ul. Długa 12, 31-147 Kraków, NIP: 676-248-11-93", 28, False, L),
    ("Nabywca: Biuro Rachunkowe Łoś i Wspólnicy", 30, True, L),
    ("ul. Świętojańska 4, 81-368 Gdynia, NIP: 586-102-33-47", 28, False, L),
    ("", 20, False, L),
    ("Lp.   Nazwa towaru                    Ilość    Cena netto    Wartość netto", 26, True, L),
    ("1     Papier ksero A4 80g             40 ryz     18,50 zł       740,00 zł", 26, False, L),
    ("2     Toner do drukarki HP 59A         3 szt.   389,00 zł     1 167,00 zł", 26, False, L),
    ("3     Segregator A4 75 mm             25 szt.     9,20 zł       230,00 zł", 26, False, L),
    ("", 20, False, L),
    ("Razem netto: 2 137,00 zł", 28, False, 900),
    ("VAT 23%: 491,51 zł", 28, False, 900),
    ("Do zapłaty: 2 628,51 zł", 34, True, 900),
    ("", 20, False, L),
    ("Sposób płatności: przelew, rachunek 12 1090 2590 0000 0001 4455 6677", 26, False, L),
]
page(invoice, 1).save(f"{out}/faktura_zuraw.jpg", quality=82)

invoice2 = [
    ("FAKTURA VAT nr 88/11/2026", 44, True, L),
    ("Data wystawienia: 03.11.2026        Termin płatności: 17.11.2026", 28, False, L),
    ("", 20, False, L),
    ("Sprzedawca: Hurtownia Papiernicza Żuraw Sp. z o.o.", 30, True, L),
    ("ul. Długa 12, 31-147 Kraków, NIP: 676-248-11-93", 28, False, L),
    ("Nabywca: Biuro Rachunkowe Łoś i Wspólnicy", 30, True, L),
    ("", 20, False, L),
    ("1     Koperty C5 białe               500 szt.     0,18 zł        90,00 zł", 26, False, L),
    ("2     Papier ksero A4 80g             20 ryz     18,50 zł       370,00 zł", 26, False, L),
    ("", 20, False, L),
    ("Razem netto: 460,00 zł", 28, False, 900),
    ("VAT 23%: 105,80 zł", 28, False, 900),
    ("Do zapłaty: 565,80 zł", 34, True, 900),
]
page(invoice2, 2).save(f"{out}/faktura_zuraw_listopad.png")

c1 = [
    ("UMOWA NAJMU LOKALU UŻYTKOWEGO", 44, True, L),
    ("zawarta w dniu 1 marca 2025 r. w Gdyni pomiędzy:", 28, False, L),
    ("", 20, False, L),
    ("Nieruchomości Bałtyk S.A. z siedzibą w Gdyni, ul. Portowa 8,", 28, False, L),
    ("zwaną dalej Wynajmującym,", 28, False, L),
    ("a Biurem Rachunkowym Łoś i Wspólnicy, zwanym dalej Najemcą.", 28, False, L),
    ("", 20, False, L),
    ("§ 1. Przedmiot umowy", 32, True, L),
    ("Wynajmujący oddaje Najemcy do używania lokal biurowy o powierzchni", 28, False, L),
    ("86 m² położony w Gdyni przy ul. Świętojańskiej 4, II piętro.", 28, False, L),
    ("", 20, False, L),
    ("§ 2. Czynsz", 32, True, L),
    ("Najemca płaci czynsz w wysokości 6 450,00 zł netto miesięcznie,", 28, False, L),
    ("płatny z góry do 10. dnia każdego miesiąca.", 28, False, L),
    ("Czynsz podlega corocznej waloryzacji o wskaźnik inflacji GUS.", 28, False, L),
]
c2 = [
    ("§ 3. Okres obowiązywania", 32, True, L),
    ("Umowa zostaje zawarta na czas określony do dnia 28 lutego 2030 r.", 28, False, L),
    ("", 20, False, L),
    ("§ 4. Wypowiedzenie", 32, True, L),
    ("Każda ze stron może wypowiedzieć umowę z zachowaniem", 28, False, L),
    ("sześciomiesięcznego okresu wypowiedzenia, ze skutkiem na koniec", 28, False, L),
    ("miesiąca kalendarzowego.", 28, False, L),
    ("", 20, False, L),
    ("§ 5. Kaucja", 32, True, L),
    ("Najemca wpłaca kaucję zabezpieczającą w wysokości 19 350,00 zł,", 28, False, L),
    ("która podlega zwrotowi w terminie 30 dni od zwrotu lokalu.", 28, False, L),
    ("", 20, False, L),
    ("Wynajmujący: ..................          Najemca: ..................", 28, False, L),
]
p1, p2 = page(c1, 3), page(c2, 4)
p1.save(f"{out}/umowa_najmu.pdf", save_all=True, append_images=[p2], resolution=200)
print("ok")
