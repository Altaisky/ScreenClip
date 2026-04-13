using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace ScreenClipClipboardHelper
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern uint GetClipboardSequenceNumber();

        static readonly object clipboardLock = new object();

        [STAThread] // ВАЖНО: Clipboard API требует STA-поток!
        static void Main(string[] args)
        {
            // Сообщаем о готовности в stderr
            Console.Error.WriteLine("ready");

            // Создаём невидимое окно для работы с буфером обмена
            using (var form = new Form())
            {
                form.Opacity = 0;
                form.ShowInTaskbar = false;
                form.FormBorderStyle = FormBorderStyle.None;
                form.WindowState = FormWindowState.Minimized;

                // Читаем команды из stdin
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (string.IsNullOrEmpty(line))
                        continue;

                    try
                    {
                        string[] parts = line.Split(new[] { ' ' }, 2);
                        string command = parts[0].ToLowerInvariant();

                        switch (command)
                        {
                            case "seq":
                                HandleSequence();
                                break;

                            case "copy":
                                if (parts.Length > 1)
                                    HandleCopy(parts[1].Trim());
                                else
                                    Console.WriteLine("ERROR: No file path provided");
                                break;

                            case "clear":
                                HandleClear();
                                break;

                            default:
                                Console.WriteLine("ERROR: Unknown command: " + command);
                                break;
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("ERROR: " + ex.Message);
                    }

                    Console.Out.Flush();
                }
            }
        }

        static void HandleSequence()
        {
            lock (clipboardLock)
            {
                uint seq = GetClipboardSequenceNumber();
                Console.WriteLine(seq.ToString());
            }
        }

        static void HandleCopy(string filePath)
        {
            lock (clipboardLock)
            {
                // Убираем кавычки если есть
                filePath = filePath.Trim('"', '\'', '^');

                if (!File.Exists(filePath))
                {
                    Console.WriteLine("ERROR: File not found: " + filePath);
                    return;
                }

                try
                {
                    // Читаем файл в память — это освобождает файловый дескриптор
                    byte[] fileBytes = File.ReadAllBytes(filePath);

                    using (MemoryStream ms = new MemoryStream(fileBytes))
                    using (Image image = Image.FromStream(ms))
                    {
                        // Создаём копи изображения для буфера
                        Bitmap clipboardImage = new Bitmap(image);

                        try
                        {
                            Clipboard.SetImage(clipboardImage);
                            Console.WriteLine("OK");
                        }
                        catch (ExternalException ex)
                        {
                            Console.WriteLine("ERROR: Clipboard access failed: " + ex.Message);
                            clipboardImage.Dispose();
                            return;
                        }

                        clipboardImage.Dispose();
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("ERROR: " + ex.Message);
                }
            }
        }

        static void HandleClear()
        {
            lock (clipboardLock)
            {
                try
                {
                    Clipboard.Clear();
                    Console.WriteLine("OK");
                }
                catch (ExternalException ex)
                {
                    Console.WriteLine("ERROR: Clipboard clear failed: " + ex.Message);
                }
            }
        }
    }
}
