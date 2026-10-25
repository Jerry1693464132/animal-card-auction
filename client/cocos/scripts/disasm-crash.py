import capstone, sys

EXE = r"C:\Users\ABC\Desktop\cursor\client\cocos-cli-smoke-test\build\windows\proj\Release\windows.exe"
CRASH_OFF = 0x375a4a

with open(EXE, "rb") as f:
    data = f.read()

# PE parsing
pe_off = int.from_bytes(data[0x3C:0x40], "little")
assert data[pe_off:pe_off+4] == b"PE\0\0"
num_sections = int.from_bytes(data[pe_off+6:pe_off+8], "little")
opt_size = int.from_bytes(data[pe_off+20:pe_off+22], "little")
opt_off = pe_off + 24
magic = int.from_bytes(data[opt_off:opt_off+2], "little")
image_base = int.from_bytes(data[opt_off+24:opt_off+32], "little")
sec_off = opt_off + opt_size

sections = []
for i in range(num_sections):
    o = sec_off + i * 40
    name = data[o:o+8].rstrip(b"\0").decode(errors="replace")
    vsize = int.from_bytes(data[o+8:o+12], "little")
    vaddr = int.from_bytes(data[o+12:o+16], "little")
    rawsize = int.from_bytes(data[o+16:o+20], "little")
    rawptr = int.from_bytes(data[o+20:o+24], "little")
    sections.append((name, vaddr, vsize, rawptr, rawsize))

print(f"magic=0x{magic:x} image_base=0x{image_base:x} sections={num_sections}")
for s in sections:
    print(f"  {s[0]:<10} vaddr=0x{s[1]:08x} vsize=0x{s[2]:08x} raw=0x{s[3]:08x} rawsize=0x{s[4]:08x}")

def off_to_file(rva):
    for name, vaddr, vsize, rawptr, rawsize in sections:
        if vaddr <= rva < vaddr + max(vsize, rawsize):
            return rawptr + (rva - vaddr)
    return None

file_off = off_to_file(CRASH_OFF)
print(f"\ncrash RVA 0x{CRASH_OFF:x} -> file offset 0x{file_off:x}" if file_off else "not mapped")

# disassemble around crash
start = CRASH_OFF - 0x40
start_off = off_to_file(start)
code = data[start_off:start_off + 0xC0]

md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
md.detail = True
print("\n===== disassembly around crash =====")
for insn in md.disasm(code, image_base + start):
    rva = insn.address - image_base
    marker = "  <<<<< CRASH" if rva == CRASH_OFF else ""
    print(f"0x{rva:08x}  {insn.mnemonic:<10} {insn.op_str}{marker}")
